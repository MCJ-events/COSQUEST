# The CostQuest game (ubmids/costquest-ios, copied into Game/ by
# scripts/sync-game-from-ios.sh) as a pod of the CosQuest app.
#
# Unity. UnityFramework.framework is built for devices only. With it in
# ios/Frameworks (scripts/fetch-unity-framework.sh), device builds link and
# embed it and simulator builds leave it out, exactly as costquest-ios's
# CostQuest / CostQuestSim targets do (NO_UNITY, the five Unity files
# excluded). Without it, or with COSTQUEST_NO_UNITY=1 at `pod install`,
# every build is the no-Unity one: the world home, points and quizzes work;
# event field maps fall back to the native map and fights say they need the
# full build.
unity_binary = File.join(__dir__, 'Frameworks', 'UnityFramework.framework', 'UnityFramework')
with_unity = File.exist?(unity_binary) && ENV['COSTQUEST_NO_UNITY'] != '1'
unity_files = %w[UnityBridge.swift UnityWorldView.swift UnityDuelHost.swift UnityBattleHost.swift UnityHallHost.swift]

Pod::UI.puts "[CostQuestGame] #{with_unity ? 'with UnityFramework (device builds)' : 'WITHOUT Unity (NO_UNITY everywhere)'}"

Pod::Spec.new do |s|
  s.name           = 'CostQuestGame'
  s.version        = '0.1.0'
  s.summary        = 'The CostQuest AR game, embedded in the CosQuest app'
  s.description    = 'SwiftUI + RealityKit + ARKit game with Unity as a library, hosted by an Expo module.'
  s.license        = { :type => 'Proprietary' }
  s.author         = 'DJMC'
  s.homepage       = 'https://github.com/MCJ-events/COSQUEST'
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '6.0'
  s.source         = { git: 'https://github.com/MCJ-events/COSQUEST.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'Embed/**/*.{h,swift}', 'Game/**/*.{h,c,swift}'
  # The C surface Swift sees (through the pod's own module): the engine's
  # one header and the Unity callback setters. Everything else stays private.
  s.public_header_files = 'Embed/CostQuestGameBridge.h', 'Game/Engine/mote_lib.h', 'Game/Engine/error.h'
  s.exclude_files = with_unity ? [] : unity_files.map { |f| "Game/Unity/#{f}" }

  s.resource_bundles = {
    'CostQuestGame' => ['Resources/Fonts/*.ttf', 'Resources/CostQuestGame.xcassets']
  }

  s.frameworks = 'ARKit', 'RealityKit', 'CoreLocation', 'CoreMotion', 'CoreNFC',
                 'NearbyInteraction', 'Network', 'Speech', 'AVFoundation', 'StoreKit',
                 'SafariServices', 'MapKit', 'Metal', 'CryptoKit', 'CoreHaptics', 'CoreImage'

  settings = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_STRICT_CONCURRENCY' => 'complete',
    # Game/Engine is the mote engine, verbatim. Built for speed in every
    # configuration (costquest-ios project.yml says why), one core kept free.
    'GCC_C_LANGUAGE_STANDARD' => 'c11',
    'GCC_OPTIMIZATION_LEVEL' => '3',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) MOTE_RESERVE_CORES=1',
    'HEADER_SEARCH_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/Game/Engine"',
  }
  if with_unity
    settings['FRAMEWORK_SEARCH_PATHS[sdk=iphoneos*]'] = '$(inherited) "${PODS_TARGET_SRCROOT}/Frameworks"'
    settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS[sdk=iphonesimulator*]'] = '$(inherited) NO_UNITY'
    settings['EXCLUDED_SOURCE_FILE_NAMES[sdk=iphonesimulator*]'] = unity_files.join(' ')
  else
    settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited) NO_UNITY'
  end
  s.pod_target_xcconfig = settings

  if with_unity
    # The app links Unity on devices; the config plugin's build phase
    # ("[CostQuest] Embed UnityFramework") copies and signs it into the app.
    s.user_target_xcconfig = {
      'FRAMEWORK_SEARCH_PATHS[sdk=iphoneos*]' => '$(inherited) "${PODS_ROOT}/../../modules/costquest-game/ios/Frameworks"',
      'OTHER_LDFLAGS[sdk=iphoneos*]' => '$(inherited) -framework UnityFramework',
    }
  end
end
