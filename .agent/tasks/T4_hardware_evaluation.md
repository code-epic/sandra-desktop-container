# Tarea T4: Algoritmo de Evaluación de Hardware

## Objetivo
Crear una lógica que permita a Sandra decidir si debe ejecutar la interfaz completa o una versión optimizada basada en las capacidades del equipo.

## Pasos de Ejecución
1. [ ] Investigar API de Rust (`sysinfo`) para obtener RAM Total de forma precisa.
2. [ ] Investigar API de Angular para detectar latencia de frames (FPS).
3. [ ] Definir Perfiles de Rendimiento:
   - **PERFIL_ALTO**: > 4GB RAM, CPU > 4 Cores. (Efectos full).
   - **PERFIL_MEDIO**: 2GB - 4GB RAM. (Blur reducido).
   - **PERFIL_LEGADO**: < 2GB RAM. (Sin efectos, sin animaciones).
4. [ ] Crear un `PerformanceService` en Angular que inyecte la clase `.perf-legacy` en el `body`.

## Notas Técnicas
- El equipo actual tiene **1.00 GB RAM**, lo cual lo sitúa inmediatamente en el **PERFIL_LEGADO**.
- El CPU E2180 no tiene instrucciones AVX modernas, lo que ralentiza el renderizado de gráficos complejos.
