# Builds a release APK on Windows: a clean prebuild, then Gradle.
#
#   powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1 -Variant demo -OutDir F:\apk
#
# prod  md.una.retail       talks to api.baseUrl of config/app.config.json
# demo  md.una.retail.demo  answers from the mock backend inside the app, no server
#
# The APK is signed with the Android debug key: it installs on a phone, but a
# store release needs its own key.
param(
  [ValidateSet("prod", "demo")][string]$Variant = "prod",
  [string]$OutDir = (Join-Path $PSScriptRoot "..\..\apk"),
  [string]$SdkDir = $env:ANDROID_HOME,
  [string]$JavaHome = $env:JAVA_HOME,
  [string]$Abis = "armeabi-v7a,arm64-v8a"
)

# Continue: native tools write warnings to stderr; failures are caught by exit code.
$ErrorActionPreference = "Continue"
if (-not $SdkDir) { throw "ANDROID_HOME is not set: pass -SdkDir" }
if (-not $JavaHome) { throw "JAVA_HOME is not set: pass -JavaHome (JDK 17)" }

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $SdkDir
$env:ANDROID_SDK_ROOT = $SdkDir
$env:Path = "$JavaHome\bin;" + $env:Path
$env:CI = "1"
$mobile = Split-Path $PSScriptRoot -Parent
Set-Location $mobile

if ($Variant -eq "demo") { $env:APP_VARIANT = "demo"; $env:EXPO_PUBLIC_DEMO = "1" }
else { Remove-Item Env:APP_VARIANT, Env:EXPO_PUBLIC_DEMO -ErrorAction SilentlyContinue }

# prebuild rewrites two scripts of package.json; they are put back afterwards.
$package = [IO.File]::ReadAllBytes("$mobile\package.json")
"=== prebuild ($Variant) ==="
& npx expo prebuild --platform android --clean --no-install
$prebuild = $LASTEXITCODE
[IO.File]::WriteAllBytes("$mobile\package.json", $package)
if ($prebuild -ne 0) { throw "prebuild failed" }

# prebuild --clean regenerates android/, so the local settings go in every time.
$props = "$mobile\android\gradle.properties"
(Get-Content $props) -replace '^reactNativeArchitectures=.*', "reactNativeArchitectures=$Abis" |
  Set-Content $props -Encoding ascii
$escaped = $SdkDir.Replace('\', '\\').Replace(':', '\:')
Set-Content "$mobile\android\local.properties" "sdk.dir=$escaped" -Encoding ascii

"=== gradle ==="
Set-Location "$mobile\android"
& .\gradlew.bat assembleRelease --max-workers=4 --console=plain
if ($LASTEXITCODE -ne 0) { throw "gradle failed" }

# The variant is inlined into the JS bundle: check the bundle, not the intention.
$apk = "$mobile\android\app\build\outputs\apk\release\app-release.apk"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($apk)
$memory = New-Object IO.MemoryStream
$stream = $zip.GetEntry("assets/index.android.bundle").Open()
$stream.CopyTo($memory)
$stream.Dispose()
$zip.Dispose()
$bundle = [Text.Encoding]::GetEncoding(28591).GetString($memory.ToArray())
$other = if ($Variant -eq "demo") { "prod" } else { "demo" }
if (-not $bundle.Contains("una-build:$Variant") -or $bundle.Contains("una-build:$other")) {
  throw "the bundle is not a $Variant build: clear %TEMP%\metro-cache and build again"
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
$version = ([Text.Encoding]::UTF8.GetString($package) | ConvertFrom-Json).version
$sha = (git -C $mobile rev-parse --short HEAD)
$label = if ($Variant -eq "demo") { "UNA-Market-Demo" } else { "UNA-Market" }
$target = Join-Path $OutDir "$label-$version-$sha.apk"
Copy-Item $apk $target -Force
"BUILT $target"
