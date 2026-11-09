// Pone el icono de Two-Nova en el .exe sin necesitar Wine (compilando desde Linux) ni herramientas de Windows.
const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const ico = path.join(context.packager.projectDir, 'build', 'icon.ico');
  const pkg = context.packager.appInfo;
  const nt = ResEdit.NtExecutable.from(fs.readFileSync(exe));
  const res = ResEdit.NtExecutableResource.from(nt);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(ico));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const group = groups[0];
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, group ? group.id : 101, group ? group.lang : 1033, iconFile.icons.map((i) => i.data));

  const versions = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (versions[0]) {
    const v = versions[0];
    const lang = v.getAllLanguagesForStringValues()[0] || { lang: 1033, codepage: 1200 };
    v.setStringValues(lang, {
      ProductName: pkg.productName, FileDescription: pkg.productName,
      CompanyName: 'S1even', LegalCopyright: '© 2026 S1even', OriginalFilename: `${pkg.productFilename}.exe`,
      InternalName: pkg.productName,
    });
    v.outputToResourceEntries(res.entries);
  }
  res.outputResource(nt);
  fs.writeFileSync(exe, Buffer.from(nt.generate()));
  console.log('  • icono y datos del .exe actualizados (S1even)');
};
