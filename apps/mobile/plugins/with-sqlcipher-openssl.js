const { withAppBuildGradle } = require("expo/config-plugins");

const OPENSSL_COORDINATE = "io.github.ronickg:openssl:3.3.2-1";
const COPY_TASK = "copySqlcipherOpenSslJni";
const OPENSSL_GRADLE = `configurations {
    sqlcipherOpenSsl {
        canBeResolved = true
        canBeConsumed = false
        transitive = false
    }
}

dependencies {
    sqlcipherOpenSsl "${OPENSSL_COORDINATE}@aar"
}

def sqlcipherOpenSslJniDir = layout.buildDirectory.dir("generated/sqlcipher-openssl/jniLibs")
def ${COPY_TASK} = tasks.register("${COPY_TASK}", Copy) {
    from({ zipTree(configurations.sqlcipherOpenSsl.singleFile) }) {
        include "prefab/modules/crypto/libs/android.*/libcrypto.so"
        eachFile { details ->
            details.path = details.path.substring("prefab/modules/crypto/libs/android.".length())
        }
        includeEmptyDirs = false
    }
    into(sqlcipherOpenSslJniDir)
}

def verifySqlcipherOpenSslJni = tasks.register("verifySqlcipherOpenSslJni") {
    dependsOn(${COPY_TASK})
    doLast {
        ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"].each { abi ->
            if (!sqlcipherOpenSslJniDir.get().file("\${abi}/libcrypto.so").asFile.isFile()) {
                throw new GradleException("SQLCipher OpenSSL AAR is missing libcrypto.so for \${abi}")
            }
        }
    }
}

android.sourceSets.main.jniLibs.srcDir(sqlcipherOpenSslJniDir)
tasks.configureEach {
    if (name.startsWith("merge") && name.endsWith("JniLibFolders")) {
        dependsOn(verifySqlcipherOpenSslJni)
    }
}`;

function applySqlcipherOpenSsl(contents) {
  const coordinates = [...contents.matchAll(/io\.github\.ronickg:openssl:[\w.-]+/gu)];
  if (coordinates.some(([coordinate]) => coordinate !== OPENSSL_COORDINATE)) {
    throw new Error("SQLCipher OpenSSL runtime dependency has a different version.");
  }
  if (!/^android\s*\{/mu.test(contents) || !/^dependencies\s*\{/mu.test(contents)) {
    throw new Error("Could not find the app Android and dependencies blocks for SQLCipher OpenSSL.");
  }

  if (contents.includes(COPY_TASK)) return contents;
  if (coordinates.length > 0) {
    throw new Error("SQLCipher OpenSSL is already declared outside its JNI packaging block.");
  }
  return `${contents.trimEnd()}\n\n${OPENSSL_GRADLE}\n`;
}

function withSqlcipherOpenSsl(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error("SQLCipher OpenSSL plugin requires a Groovy app build script.");
    }
    config.modResults.contents = applySqlcipherOpenSsl(config.modResults.contents);
    return config;
  });
}

module.exports = withSqlcipherOpenSsl;
module.exports.applySqlcipherOpenSsl = applySqlcipherOpenSsl;
module.exports.OPENSSL_COORDINATE = OPENSSL_COORDINATE;
