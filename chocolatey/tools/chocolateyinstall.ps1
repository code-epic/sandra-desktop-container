$ErrorActionPreference = 'Stop'

# Fetch the script's directory (tools folder)
$toolsDir   = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"

# The NSIS setup .exe or .msi file should be placed in this folder before packing.
# Find the installer file in the tools directory
$installerExe = Get-ChildItem -Path $toolsDir -Filter "*.exe" | Select-Object -First 1

if (-not $installerExe) {
    Write-Warning "Could not find any installer executable (.exe) in the tools directory."
    $installerMsi = Get-ChildItem -Path $toolsDir -Filter "*.msi" | Select-Object -First 1
    if (-not $installerMsi) {
        throw "Could not find any installer (.exe or .msi) in the tools directory."
    }
    $installerExe = $installerMsi
}

$fileLocation = $installerExe.FullName

# Determine the file type for the parameters
$fileType = "exe"
if ($installerExe.Extension -eq ".msi") {
    $fileType = "msi"
}

$packageArgs = @{
    packageName   = $env:ChocolateyPackageName
    fileType      = $fileType
    file          = $fileLocation
    silentArgs    = '/S'         # /S for NSIS installer silent mode
    validExitCodes= @(0, 1641, 3010, 6666212)
}

if ($fileType -eq "msi") {
    $packageArgs['silentArgs'] = '/qn /norestart' # standard MSI silent arguments
}

Install-ChocolateyInstallPackage @packageArgs
