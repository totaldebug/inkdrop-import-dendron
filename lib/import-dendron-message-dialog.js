"use babel";

import * as React from "react";
import { CompositeDisposable } from "event-kit";

export default class ImportDendronMessageDialog extends React.Component {
  componentWillMount() {
    // Events subscribed to in Inkdrop's system can be easily cleaned up with a CompositeDisposable
    this.subscriptions = new CompositeDisposable();

    // Register command that toggles this dialog
    this.subscriptions.add(
      inkdrop.commands.add(document.body, {
        "import-dendron:invoke": () => this.invoke()
      })
    );
  }

  componentWillUnmount() {
    this.subscriptions.dispose();
  }

  render() {
    const { MessageDialog, NotebookListBar } = inkdrop.components.classes;
    if (!MessageDialog || !NotebookListBar) return null;
    return (
      <MessageDialog
        ref={el => (this.dialog = el)}
        title="Now importing Notes from Dendron Vault"
      >
        <i class="notched circle big loading icon"></i>
        importing...
      </MessageDialog>
    );
  }

  importDendronNotebook = async () => {
    const {
      openImportDialog,
      importNotebooksFromDendronLibrary
    } = require("./importer");
    const { filePaths } = await openImportDialog();

    // if no file is selected, return
    if (!filePaths || filePaths.length === 0) {
      return false;
    }

    const { dialog } = this;
    if (!dialog.isShown) {
      dialog.showDialog();
    }

    // umm... ugly hack for displaying loading indicator
    setTimeout(async function () {
      await importNotebooksFromDendronLibrary(filePaths);
      setTimeout(() => {
        dialog.dismissDialog(-1);
      }, 2000);
    }, 2000);
  };

  invoke() {
    this.importDendronNotebook();
  }
}
