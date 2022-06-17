'use babel';

import ImportDendronMessageDialog from './import-dendron-message-dialog';

module.exports = {

  activate() {
    inkdrop.components.registerClass(ImportDendronMessageDialog);
    inkdrop.layouts.addComponentToLayout(
      'modal',
      'ImportDendronMessageDialog'
    )
  },

  deactivate() {
    inkdrop.layouts.removeComponentFromLayout(
      'modal',
      'ImportDendronMessageDialog'
    )
    inkdrop.components.deleteClass(ImportDendronMessageDialog);
  }

};
