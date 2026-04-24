export interface DiskStats {
  name: string;
  free_space: number;
  total_space: number;
}

export interface SystemStats {
  disk_total: number;
  disk_free: number;
  os_info: string;
  mac_address: string;
  total_memory: number;
  used_memory: number;
}