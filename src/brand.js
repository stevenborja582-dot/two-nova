// Nombre de la app y autor. Cambia el nombre aquí (y "productName" en package.json).
// Two-Nova es el nombre de la app. S1even es solo el autor.
module.exports = {
  appName: 'Two-Nova',
  author: 'S1even',
  // Etiqueta que marca las entradas que esta app escribe en la configuración de Claude Code.
  hookTag: 'app=two-nova',
  // Etiquetas de versiones anteriores, para poder limpiarlas.
  legacyHookTags: ['app=isla'],
  defaultPort: 47653,
};
