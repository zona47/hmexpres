# Auditoría · App «Sistema Andromeda 2026»

**Estado: APROBADA. 122 de 122 comprobaciones superadas, y 125 de 125 con tu CSV real** (27-sep-2026, versión 2: modo fácil).
Archivo auditado: `app/index.html` (un único HTML autocontenido, sin dependencias externas).
Regla del proyecto: ningún HTML se entrega a Netlify sin pasar esta auditoría. Para repetirla:

```bash
npm install
npm run audit        # recalcula el hash CSP y ejecuta las 122 comprobaciones; sale con error si falla alguna
REAL_CSV=/ruta/informe.csv npm run audit   # +3 pruebas con un CSV real (no se sube al repositorio)
```

El detalle de cada comprobación se guarda en `audit/resultados.json`.

## 1. Documentación de origen

| Documento | Versión | Uso en la app |
|---|---|---|
| `Modelo_Economico_y_Escalado_2026.xlsx` | Las 2 copias recibidas son idénticas (0 celdas distintas) | Motor de cálculo: 357 fórmulas y 219 entradas replicadas |
| `Playbook_Sistema_Campanas_Andromeda_2026` (PDF) | Las 2 copias tienen el mismo texto | Umbrales de decisión, alertas, zonas y benchmarks |
| `Cómo funciona y cómo se aplica` / `Guia_de_Aplicacion_Paso_a_Paso` | El .md y los 2 PDF tienen el mismo texto | Rutina semanal, plan de 8 pasos, plan de 48 h |
| `Manual_de_arranque` (.md y PDF) | Mismo texto | Pestañas «Arranque (3 días)» y «Prueba de 21 días» |
| CSV de Meta «Conjuntos de anuncios 27-sep-2026» | Exportación real del usuario | Pestaña «Informe de campaña» y modo fácil (formato de columnas) |
| Datos del producto (chat) | Precio 14,90 USD; añadidos de 9 y 8 USD | Configuración inicial del modo fácil |

## 2. Qué se comprobó

| Área | Pruebas | Qué verifica |
|---|---|---|
| Paridad con el Excel | 4 | Las 357 fórmulas dan el mismo valor que el Excel (tolerancia relativa 1e-9), y las 219 entradas por defecto son idénticas. Además, el recálculo se contrasta con una cuenta hecha a mano |
| Coherencia con el Playbook | 16 | Cifras citadas: CM1 485,9 · aMER 2,70x · LTV:CAC 3,28x · índice 80,8 GO · 545.482 USD invertidos · 3.079 clientes · ROI 1,74x · punto óptimo 1.000 USD/día… |
| Reglas de decisión | 14 | Calculadora de corte, Nivel A/B, aMER marginal, puerta EMQ, aprendizaje (7 días y 50 conversiones), 14 alertas, tarea 4, días 7 y 21 |
| Informe CSV | 18 (16 + 2 con el CSV real) | Formato de Meta en español e inglés, separadores `,` y `;`, decimales con punto o coma, comillas, totales recalculados, suma de informes diarios, ganador, envío a la rutina y al panel, archivo no válido, persistencia y tu CSV real |
| Modo fácil | 22 (21 + 1 con el CSV real) | La app abre en una sola pantalla con tu producto precargado (CM1 comprobado con una cuenta a mano). Se prueban 9 escenarios de «qué hacer hoy» (tu caso actual, días 7, 14 y 21, escalar, parar, frecuencia), el Excel `.xlsx` de Meta (incluye fechas como celdas de fecha y la fila de totales), un archivo no válido, el cambio de precio y el cambio de modo |
| Interfaz | 22 | Las 14 pestañas, teclado, recálculo, persistencia, restablecer, entradas no válidas, división por cero, rutina, cuaderno, arranque, prueba de 21 días, gráfico con tooltip |
| Seguridad | 9 | CSP con hash (sin `unsafe-inline` en los scripts), sin red ni recursos externos, sin `innerHTML`/`eval`, XSS en el cuaderno y en los nombres del CSV, CSV exportado sin inyección de fórmulas, importación JSON validada |
| Responsive | 12 | 360, 768 y 1280 px, en modo claro y oscuro: sin scroll horizontal y con campos de tabla legibles |
| Accesibilidad | 4 | axe-core sin violaciones en todas las pestañas (360 y 1280 px, claro y oscuro) |
| HTML / Consola / Robustez | 4 | html-validate sin errores; sin ids duplicados; consola sin errores ni avisos; funciona con el almacenamiento bloqueado |

También se revisaron las capturas a mano. Esa revisión encontró los campos de CAC/AOV aplastados en la tabla de 12 meses: se corrigieron y se añadió una comprobación automática.

**Defectos encontrados y corregidos en la versión 2:**
- Un campo de la tarea 4 y un contenedor compartían el mismo `id`. Ahora la auditoría comprueba que no haya ids duplicados.
- La columna «Quitar» de la tabla de informes no tenía encabezado accesible.
- En el modo fácil faltaba la región principal para lectores de pantalla.

## 2b. Modo fácil: de dónde sale cada consejo

| Situación | Qué dice la app | Fuente |
|---|---|---|
| Menos de 7 días, sin ventas y con 5 o más pagos iniciados | Revisa hoy la página de pago (compra de prueba) y no toques los anuncios | Puerta 1 del sistema (sin señal limpia no se decide) + Manual de arranque «no toques nada 7 días» |
| Menos de 7 días | Espera; no toques presupuesto, anuncios ni públicos | Manual de arranque, tarea 9 y parte 5 |
| Día 7 o más sin ventas | Para (pausa sin borrar) y cambia de ángulo | Manual, día 7 («cobrado < mitad → vuelve al día 1») |
| Día 7 o más, cada venta cuesta más de lo que deja | Para | Regla de oro: nunca pagar un cliente por encima de su contribución |
| Días 7 a 13 | Si hay mercado, sigue igual hasta el día 14; si no, revisa el cierre o el ángulo | Manual, día 7 |
| Días 14 a 20 | Deja el mejor conjunto, apaga el resto, 3 versiones nuevas, sube un 20 % | Manual, día 14 |
| Día 21 o más | Escala / mantén / optimiza / para | Manual, día 21 (tramos de la app, apartado 4) |
| Frecuencia > 3 o CTR < 1 % | Prepara anuncios nuevos / cambia el gancho | Ritual de los lunes y benchmarks del Playbook §6.2 |

Notas del modo fácil:
- El «límite para ganar» es el CAC del Nivel A verde: lo que te deja cada cliente ÷ 2,40, redondeado hacia abajo (6,62 USD con tu producto).
- En el modo fácil se aplica el calendario del Manual de arranque (días 7, 14 y 21), sin exigir 50 compras. Con un presupuesto de unos 30 USD al día, esa exigencia del Playbook nunca se cumpliría.
- **Supuesto pendiente de tu dato real:** que el 32 % de los compradores se lleva cada añadido (valor de referencia del Excel). Se puede cambiar en «Cambiar precios → Más opciones».

## 3. Contradicciones encontradas en la documentación

Criterio aplicado: **los cálculos siguen al Excel** (el «motor de decisión») y **los umbrales de decisión siguen al Playbook** cuando el Excel no los define o se contradice. La app muestra estas notas al usuario en la pestaña Resumen. **Pendiente de tu confirmación:**

1. **Calculadora de corte.** El Excel (`Guardian de Pausas!D42`) compara el aMER de la prueba con el MER de break-even (1,24x) y declara «Continuar» para 2,07x. El Playbook §5.6 y el manual dicen: ≥ 2,40x continuar, 1,20–2,39x pausar, < 1,20x apagar. **La app aplica el Playbook** y muestra el resultado del Excel como trazabilidad.
2. **Alertas del Guardián.** En el Excel, el umbral crítico de CAC (379,6 USD) es menor que el de alerta (414,1 USD), y varios umbrales difieren del Playbook §5.2 (frecuencia 4 frente a 4,5, EMQ 5 frente a 6, reembolso 16 % frente a 18 %…). **La app usa los 14 indicadores del Playbook.**
3. **CAC crítico y de apagado.** El resumen del Playbook dice 338 USD y 193 USD («70 % y 40 % del break-even»); su propia tabla §3.3 y el Excel dan 379,6 USD y 485,9 USD. **La app usa el Nivel A** (Excel y §3.3).
4. **MER frente a aMER.** El manual llama «MER» a contribución ÷ gasto; en el resto de documentos, MER = ingreso ÷ gasto. **La app calcula los dos por separado**, cada uno con sus zonas.
5. **CAC objetivo en el Manual de arranque.** La regla dice «60 % del techo» (263 USD en el ejemplo), pero el ejemplo da 175–185 USD (40 %, que coincide con los 180 USD del Excel). **La app muestra ambos**; el porcentaje es editable (por defecto, 60 % tal como está escrito).
6. **Orden de la instrumentación.** El manual la sitúa en la semana 1–2 (antes de la preventa); el Playbook, en la semana 8 (después). **La app sigue el manual**: sin EMQ > 7 no se gasta.
7. **Tiers de inversión.** El Excel usa un CAC máximo de 276 USD para todos los tiers; el Playbook §3.4 propone 180/200/220/240 USD. Se muestra el valor del Excel, con una nota.
8. **Detalles menores del Excel** (se replican tal cual, con una nota): el payback se calcula como CAC ÷ CM1 × 30 (11,1 días), aunque el Playbook dice «inmediato»; la contribución mensual de la simulación usa el CM1 fijo y no el AOV del mes; el EBITDA publicitario no descuenta comisiones ni COGS.
9. **Tarea 4 del arranque.** Aplica los tres descuentos sobre el ingreso y usa un COGS del 10 % (el Excel usa el 7 % sobre el ingreso neto y añade la comisión fija). Por eso su techo (438,7 USD) es distinto del CM1 del modelo completo (485,9 USD). Ambos se muestran en su pestaña.

## 4. Supuestos propios de la app (no están en los documentos)

- **Escenarios de reembolso** (plan de 48 h): optimista = base − 3 puntos; pesimista = 12 % (umbral de alerta). Ambos son editables.
- **Día 21:** el manual no da cifras para «muy por debajo» ni «cerca». La app usa ≤ 90 % del objetivo para escalar, ≤ 110 % para mantener, hasta el techo para optimizar y por encima del techo para parar.
- **Informe CSV:**
  - La contribución se estima como compras × CM1.
  - El «mejor» conjunto es el de más compras; a igualdad, el de menor coste por pago iniciado y luego el de menor CPC.
  - La frecuencia total se aproxima como impresiones ÷ alcance (el alcance entre conjuntos no es aditivo).
  - Con 10 o más pagos iniciados y 0 compras, la app avisa que se revise el evento de compra.
- **Aviso sobre tu CSV del 27-sep:** 21 pagos iniciados y 0 compras. Conviene comprobar que el evento de compra llega a Meta antes de juzgar los anuncios.

## 5. Publicación en Netlify

- La app vive en `/app/` y la tarjeta digital existente (`/index.html`) no se modificó.
- `netlify.toml` añade cabeceras de seguridad y devuelve 404 en `/audit/`, `/tools/`, `/node_modules/` y `package*.json`.
- Los datos (supuestos, cuaderno, informes) se guardan solo en el navegador de cada usuario (`localStorage`). No hay servidor ni base de datos. Para pasarlos a otro dispositivo se usa Exportar/Importar JSON.
- Si se edita el JavaScript, hay que ejecutar `npm run audit`: regenera el hash CSP. Sin ese paso, el navegador bloquearía el script.
