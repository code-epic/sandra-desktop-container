export interface IFirmaDigital {
    direccionmac: string;
    tiempo: string;
    nivel: number;
    vigencia: number;
    duracion: number;
    sesion: string;
}

export interface IRol {
    [key: string]: any;
}

export interface IAplicacion {
    id: string;
    nombre: string;
    url: string;
    origen: string;
    comentario: string;
    version: string;
    autor: string;
    Rol: IRol;
}

export interface ISucursalItem {
    Key: string;
    Value: string;
}

export interface IUsuario {
    id: string;
    cedula: string;
    nombre: string;
    usuario: string;
    correo: string;
    cargo: string;
    descripcion: string;
    direccion: string;
    sistema: string;
    sucursal: ISucursalItem[][];
    fechacreacion: string;
    estatus: number;
    Perfil: {
        descripcion: string;
    };
    FirmaDigital: IFirmaDigital;
    Aplicacion: IAplicacion[];
    multiplesesion: boolean;
    token?: string;
}

export interface ISandraJwtPayload {
    Usuario: IUsuario;
    sid: string;
    exp: number;
    iss: string;
}
