$ErrorActionPreference = 'Stop'

$packageName = 'sandradc'
$toolsDir    = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"

$packageArgs = @{
  packageName   = $packageName
  unzipLocation = $toolsDir
  fileType      = 'exe'
  url           = '{{URL}}'
  silentArgs    = '/S'
  validExitCodes= @(0, 1641, 3010, 6666212)
  softwareName  = 'Sandra Desktop Container'
  checksum      = '{{CHECKSUM}}'
  checksumType  = 'sha256'
}

Install-ChocolateyPackage @packageArgs
