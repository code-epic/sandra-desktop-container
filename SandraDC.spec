Name:           SandraDC
Version:        0.1.3
Release:        1%{?dist}
Summary:        Sandra Desktop Container

License:        MIT
URL:            https://github.com/code-epic/sandra-desktop-container
# COPR generará este archivo automáticamente a partir del repositorio
Source0:        %{name}-%{version}.tar.gz

BuildRequires:  nodejs
BuildRequires:  npm
BuildRequires:  cargo
BuildRequires:  rust
BuildRequires:  webkit2gtk4.1-devel
BuildRequires:  gtk3-devel
BuildRequires:  librsvg2-devel
BuildRequires:  openssl-devel
BuildRequires:  glib2-devel
BuildRequires:  libappindicator-gtk3-devel
BuildRequires:  curl
BuildRequires:  wget
BuildRequires:  file
BuildRequires:  gcc-c++

%description
Sandra Desktop Container.
Paquete construido automáticamente desde SCM para Fedora COPR.

%prep
# Copr descarga el repo y crea el tar.gz. Esta macro lo extrae.
# Si Copr falla indicando que el directorio no coincide, puedes 
# intentar cambiar esto a %setup -q -n sandra-desktop-container o %setup -q -c
%autosetup -n %{name}-%{version}

%build
# COPR necesita acceso a internet habilitado en la configuración del proyecto
# para poder descargar las cajas (crates) de Rust y los paquetes de NPM.
export CARGO_HOME="$HOME/.cargo"
export npm_config_cache="$HOME/.npm"

# 1. Instalar dependencias web
npm install

# 2. Compilar aplicación web
npm run build

# 3. Compilar el backend de Rust / Tauri
cd src-tauri
cargo build --release

%install
rm -rf %{buildroot}
          
# 1. Instalar Binario
mkdir -p %{buildroot}%{_bindir}
install -m 755 src-tauri/target/release/sandra-desktop-container %{buildroot}%{_bindir}/%{name}

# 2. Instalar el Acceso Directo (.desktop)
mkdir -p %{buildroot}%{_datadir}/applications
cat <<EOF > %{buildroot}%{_datadir}/applications/%{name}.desktop
[Desktop Entry]
Name=Sandra Desktop Container
Exec=%{name}
Icon=%{name}
Type=Application
Terminal=false
Categories=Utility;
EOF

# 3. Instalar el Icono
mkdir -p %{buildroot}%{_datadir}/icons/hicolor/128x128/apps
install -m 644 src-tauri/icons/128x128.png %{buildroot}%{_datadir}/icons/hicolor/128x128/apps/%{name}.png

%files
%{_bindir}/%{name}
%{_datadir}/applications/%{name}.desktop
%{_datadir}/icons/hicolor/128x128/apps/%{name}.png

%changelog
* Fri Feb 27 2026 Nombre Apellido <correo@ejemplo.com> - 0.1.3-1
- Compilación inicial directa desde SCM (GitHub) para COPR.
