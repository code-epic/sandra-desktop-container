$ErrorActionPreference = 'Stop'

# Chocolatey's auto-uninstaller is enabled by default, so you typically do not need
# to supply the uninstaller script unless you have a portable application or
# complicated logic. But we provide a placeholder here.

# To manually uninstall:
# Uninstall-ChocolateyPackage -PackageName $env:ChocolateyPackageName -FileType "exe" -SilentArgs "/S" -File "$env:ProgramFiles\Sandra Desktop Container\uninstall.exe"
