"use babel";

import * as remote from '@electron/remote';
import { nativeImage } from "electron";
import fs from "fs";
import path from "path";
import { models } from "inkdrop";
import mime from 'mime';
import { supportedImageFileTypes } from 'inkdrop-model'
import metadataParser from 'markdown-yaml-metadata-parser'


const { dialog, app } = remote;
const { Book, Note, Tag, File } = models;

const db = inkdrop.main.dataStore.getLocalDB();

export function openImportDialog() {
  return dialog.showOpenDialog({
    title: "Open Dendron Vault",
    properties: ["openDirectory"],
    defaultPath: app.getPath("home")
  });
}

export async function importNotebooksFromDendronLibrary(vault) {
  if (vault.length !== 1) {
    inkdrop.notifications.addError("invalid folder is selected.", {
      detail: e.stack,
      dismissable: true
    });
    return;
  }
  console.log(`processing vault ${vault[0]}`);

  const fg = require('fast-glob');
  const vaultFilePath = path.join(vault[0], '*.md').replace(/\\/g, '/')
  const notes = await fg([vaultFilePath], { onlyFiles: true, deep: 1, objectMode: true })

  if (notes.length === 0) {
    inkdrop.notifications.addError("no notebooks found in the folder.", {
      detail: e.stack,
      dismissable: true
    });
    return;
  }

  try {
    for (let note of notes) {
      await importDocumentsFromDendronVault(note);
    }
  } catch (e) {
    inkdrop.notifications.addError("Failed to import the Dendron Vault", {
      detail: e.stack,
      dismissable: true
    });
  }
}

async function importDocumentsFromDendronVault(dendronNote) {
  console.log(`processing notebooks for note: ${dendronNote.name}`);

  // uses the dot structure of the filename to create notebooks
  // and sub notebooks (folders)
  const notebook = await findOrCreateNotebook(dendronNote.name);
  console.log(`notebook: ${notebook}`);
  //creates the note
  await importNote(dendronNote.path, notebook);
}

// TODO: Still need to work on this function
async function importNote(noteDir, inkNotebookId) {
  // get the metadata from the note
  const noteData = metadataParser(fs.readFileSync(noteDir, "utf-8"));

  const { title, updated, created } = noteData.metadata;

  const note = new Note({
    title: title.slice(0, 60),
    body: noteData.content,
    createdAt: created,
    updatedAt: updated,

  });
  if (inkNotebookId != undefined) {
    note.bookId = inkNotebookId;
  }
  await note.save();
  console.log(`note: ${note}`);
  //await createAttachments(noteDir, note);
}

async function createAttachments(noteDir, note) {
  const resourceDirPath = path.join(noteDir, "resources");
  if (!fs.existsSync(resourceDirPath)) {
    return [];
  }

  const files = fs.readdirSync(resourceDirPath);

  const attachments = [];
  for (let i = 0, len = files.length; i < len; ++i) {
    const file = files[i];
    const filePath = path.join(resourceDirPath, file);

    const contentType = mime.getType(filePath)
    if (!supportedImageFileTypes.includes(contentType)) {
      continue
    }

    const buffer = fs.readFileSync(filePath)
    const attachment = new File({
      contentType: contentType,
      name: file,
      contentLength: buffer.length,
      publicIn: [note._id],
      _attachments: {
        index: {
          content_type: contentType,
          data: buffer.toString("base64")
        }
      }
    });

    await attachment.save();
    attachments.push({ att: attachment, original: file });
  }

  let newBody = note.body;
  attachments.forEach(({ att, original }) => {
    const target = `quiver-image-url/${original}`;
    newBody = newBody.replace(target, `inkdrop://${att._id}`);
  });

  note.body = newBody;
  await note.save();
}

async function findOrCreateNotebook(noteName) {
  const splitName = noteName.split(".");
  const notebookNames = splitName.slice(0, splitName.length - 2);
  console.log(notebookNames);

  let inkNotebookId;

  for (let [index, name] of notebookNames.entries()) {

    console.log(`processing folder ${name} index: ${index}`);
    const db = await inkdrop.main.dataStore.getLocalDB();
    const foundNotebook = await db.books.findWithName(name)

    // if the notebook exists then return
    if (foundNotebook) {
      inkNotebookId = foundNotebook._id;
      console.log(`found notebook ${name}, index: ${index}, id: ${inkNotebookId}`);
    }
    let book;
    if (index === 0) {
      book = new Book({
        name: name,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    } else {
      console.log(`creating notebook ${name}, index: ${index}, parent: ${inkNotebookId}`);
      book = new Book({
        name: name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        parentBookId: inkNotebookId
      });
    }
    if (foundNotebook == undefined) {
      const createdBook = await db.books.put(book)
      inkNotebookId = createdBook.id
      console.log(`created notebook ${name}, index: ${index}, id: ${inkNotebookId}`, createdBook);
    }
    return inkNotebookId;
  }
};
