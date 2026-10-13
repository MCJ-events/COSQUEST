// CostQuest: export the Unity project as an Android library (Gradle project)
// for the merged CosQuest app ("Unity as a Library").
//
// TEMPLATE kept in the app repo (modules/costquest-game/unity-android/Editor).
// scripts/export-unity-android.sh copies it into the Unity project's
// Assets/CostQuestExport/Editor/ for the duration of one export and removes it
// afterwards, so costquest-unity does not have to carry it (it may: the
// script then uses that copy and leaves it alone).
//
// Run (what the script does):
//   Unity -batchmode -nographics -quit -projectPath <costquest-unity> \
//     -buildTarget Android -executeMethod CostQuestAndroidExport.Export \
//     -cqExportPath <dir> -logFile <log>
//
// Produces <dir>/{launcher,unityLibrary,shared,build.gradle,settings.gradle,
// gradle.properties}; the app embeds unityLibrary only.
//
// Settings it forces (and puts back afterwards), matching the iOS framework
// export where it can (FRAMEWORK_PIN.md: IL2CPP Master, stripping High):
//   exportAsGoogleAndroidProject = true, IL2CPP, ARM64 only, minSdk 26,
//   Application Entry = Activity (the app hosts UnityPlayerForActivityOrService
//   in a view; GameActivity cannot be embedded that way),
//   scenes World, Duel, Hub, Battle.
#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

public static class CostQuestAndroidExport
{
    /// The scenes the app's bridges talk to (FRAMEWORK_PIN.md), in build order.
    static readonly string[] SceneNames = { "World", "Duel", "Hub", "Battle" };

    const int MinSdk = 26;

    public static void Export()
    {
        int code = 1;
        try
        {
            code = Run() ? 0 : 1;
        }
        catch (Exception e)
        {
            Debug.LogError("[CostQuestAndroidExport] " + e);
            code = 1;
        }
        if (Application.isBatchMode) EditorApplication.Exit(code);
    }

    static bool Run()
    {
        string outDir = Arg("-cqExportPath");
        if (string.IsNullOrEmpty(outDir))
        {
            Debug.LogError("[CostQuestAndroidExport] -cqExportPath <dir> is required");
            return false;
        }
        outDir = Path.GetFullPath(outDir);

        string[] scenes = SceneNames.Select(FindScene).ToArray();
        for (int i = 0; i < scenes.Length; i++)
        {
            if (scenes[i] == null)
            {
                Debug.LogError("[CostQuestAndroidExport] scene not found: " + SceneNames[i]);
                return false;
            }
        }

        if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.Android &&
            !EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Android, BuildTarget.Android))
        {
            Debug.LogError("[CostQuestAndroidExport] could not switch to Android (is Android Build Support installed?)");
            return false;
        }

        var android = NamedBuildTarget.Android;

        // Remember what we change, to leave the project as we found it.
        bool oldExport = EditorUserBuildSettings.exportAsGoogleAndroidProject;
        var oldBackend = PlayerSettings.GetScriptingBackend(android);
        var oldArch = PlayerSettings.Android.targetArchitectures;
        var oldMinSdk = PlayerSettings.Android.minSdkVersion;
        var oldEntry = PlayerSettings.Android.applicationEntry;
        var oldIl2Cpp = PlayerSettings.GetIl2CppCompilerConfiguration(android);
        var oldStripping = PlayerSettings.GetManagedStrippingLevel(android);

        try
        {
            EditorUserBuildSettings.exportAsGoogleAndroidProject = true;
            PlayerSettings.SetScriptingBackend(android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = (AndroidSdkVersions)MinSdk;
            PlayerSettings.Android.applicationEntry = AndroidApplicationEntry.Activity;
            PlayerSettings.SetIl2CppCompilerConfiguration(android, Il2CppCompilerConfiguration.Master);
            PlayerSettings.SetManagedStrippingLevel(android, ManagedStrippingLevel.High);

            if (Directory.Exists(outDir)) Directory.Delete(outDir, true);
            Directory.CreateDirectory(outDir);

            var options = new BuildPlayerOptions
            {
                scenes = scenes,
                locationPathName = outDir,
                target = BuildTarget.Android,
                targetGroup = BuildTargetGroup.Android,
                options = BuildOptions.None,
            };
            BuildReport report = BuildPipeline.BuildPlayer(options);
            var summary = report.summary;
            Debug.Log($"[CostQuestAndroidExport] {summary.result}: {summary.totalErrors} errors, " +
                      $"{summary.totalWarnings} warnings, {summary.totalTime} -> {outDir}");
            if (summary.result != BuildResult.Succeeded) return false;

            if (!File.Exists(Path.Combine(outDir, "unityLibrary", "build.gradle")))
            {
                Debug.LogError("[CostQuestAndroidExport] the export has no unityLibrary/build.gradle");
                return false;
            }
            return true;
        }
        finally
        {
            EditorUserBuildSettings.exportAsGoogleAndroidProject = oldExport;
            PlayerSettings.SetScriptingBackend(android, oldBackend);
            PlayerSettings.Android.targetArchitectures = oldArch;
            PlayerSettings.Android.minSdkVersion = oldMinSdk;
            PlayerSettings.Android.applicationEntry = oldEntry;
            PlayerSettings.SetIl2CppCompilerConfiguration(android, oldIl2Cpp);
            PlayerSettings.SetManagedStrippingLevel(android, oldStripping);
            AssetDatabase.SaveAssets();
        }
    }

    /// The scene's path: from the Build Settings list if it is there, else by
    /// searching Assets/ for exactly one scene with that name.
    static string FindScene(string name)
    {
        foreach (var s in EditorBuildSettings.scenes)
        {
            if (Path.GetFileNameWithoutExtension(s.path) == name) return s.path;
        }
        var hits = AssetDatabase.FindAssets("t:Scene " + name, new[] { "Assets" })
            .Select(AssetDatabase.GUIDToAssetPath)
            .Where(p => Path.GetFileNameWithoutExtension(p) == name)
            .ToArray();
        if (hits.Length > 1)
        {
            Debug.LogError($"[CostQuestAndroidExport] {hits.Length} scenes named {name}: {string.Join(", ", hits)}");
            return null;
        }
        return hits.FirstOrDefault();
    }

    static string Arg(string name)
    {
        var args = Environment.GetCommandLineArgs();
        int i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }
}
#endif
