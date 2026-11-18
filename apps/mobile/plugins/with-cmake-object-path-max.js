const { withAppBuildGradle } = require('@expo/config-plugins');

const CMAKE_ARG = '-DCMAKE_OBJECT_PATH_MAX=250';

function addObjectPathLimit(contents) {
  if (contents.includes('CMAKE_OBJECT_PATH_MAX')) {
    return contents;
  }

  const defaultConfig = /defaultConfig\s*\{/;
  if (!defaultConfig.test(contents)) {
    throw new Error(
      'with-cmake-object-path-max: could not find defaultConfig in app/build.gradle'
    );
  }

  return contents.replace(
    defaultConfig,
    (match) => `${match}
        // Windows cannot create object paths longer than 260 characters.
        // CMake hashes long object paths when this limit is set.
        externalNativeBuild {
            cmake {
                arguments "${CMAKE_ARG}"
            }
        }`
  );
}

module.exports = function withCmakeObjectPathMax(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = addObjectPathLimit(mod.modResults.contents);
    return mod;
  });
};
