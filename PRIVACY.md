# Aviso de Privacidad y Manejo de Datos

Esta nota describe, sin tecnicismos legales, cómo maneja tus datos esta
aplicación (PWA).

## No hay servidor propio

Esta aplicación es 100% del lado del cliente (client-side): no existe
ningún servidor del autor que reciba, procese, almacene o pase por en
medio de tus datos. Todo corre directamente en tu navegador y se conecta
de forma directa a tu propia cuenta de Google.

## Qué puede tocar la app, y qué NO puede tocar

Al conectar tu cuenta de Google, la app pide permiso usando el scope
`drive.file` — un permiso de Google diseñado específicamente para que
una aplicación **solo pueda crear y administrar los archivos que ella
misma genera**, sin ninguna capacidad técnica de listar, leer o acceder
al resto de tu Google Drive.

En la práctica, esto significa que la app:

- **Sí puede**: crear y leer/escribir la hoja de cálculo (Google Sheet)
  que ella misma genera para guardar tu inventario, ventas y costos.
- **No puede**: ver, listar ni tocar ningún otro archivo, carpeta,
  documento o dato de tu Google Drive — no por una promesa, sino porque
  el permiso que la app solicita no lo permite técnicamente.

## Quién ve tus datos

Nadie más que vos. Cada persona que usa esta app se conecta con su
propia cuenta de Google, y su información vive únicamente en su propio
Drive. El autor de la app no recibe copia, no tiene acceso remoto y no
puede ver bajo ninguna circunstancia lo que cualquier usuario guarda en
su hoja de cálculo — incluyendo al propio autor, que tampoco tiene una
puerta trasera para ver datos de otras cuentas.

## Responsabilidad

El autor no se hace responsable por pérdida de datos, errores de
cálculo, ni decisiones de negocio tomadas a partir de la información que
esta aplicación muestra. Ver `LICENSE` para los términos completos de
uso del código, y `TERMS.md` para los términos de uso de la aplicación.
