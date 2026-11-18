# The mote engine for Android: the Sparks SDK's copy (node_modules/@cosquest/sparks-sdk/cpp/mote),
# the same C iOS links since build 21, plus warden_jni.c. The game module's own older copy
# (costquest-game/ios/Game/Engine, .mq v4 only) was removed: on iOS it collided with the SDK's.
cmake_minimum_required(VERSION 3.22.1)
project(costquest_warden C)

set(ENGINE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../node_modules/@cosquest/sparks-sdk/cpp/mote)
if(NOT EXISTS ${ENGINE_DIR}/mote_lib.c)
  message(FATAL_ERROR "mote engine not found at ${ENGINE_DIR} (npm install the app first)")
endif()
file(GLOB ENGINE_SOURCES ${ENGINE_DIR}/*.c)

add_library(costquest_warden SHARED warden_jni.c ${ENGINE_SOURCES})
target_include_directories(costquest_warden PRIVATE ${ENGINE_DIR})
set_target_properties(costquest_warden PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED ON)
# -O3 always (see build.gradle). MOTE_RESERVE_CORES=1 as on iOS: one core stays
# with the UI thread. NEON is baseline on arm64-v8a; the dot-product path
# (__ARM_FEATURE_DOTPROD) is NOT enabled, because not every arm64 phone has it
# and the engine selects it at compile time. x86_64 (emulators) uses the
# engine's portable C path.
target_compile_options(costquest_warden PRIVATE -O3 -fvisibility=hidden -Wno-unused-parameter)
target_compile_definitions(costquest_warden PRIVATE MOTE_RESERVE_CORES=1)
find_library(log-lib log)
target_link_libraries(costquest_warden ${log-lib} m)
