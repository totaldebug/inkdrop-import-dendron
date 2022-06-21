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

  // sort the notes by longest first
  notes.sort(function (a, b) {
    // ASC  -> a.length - b.length
    // DESC -> b.length - a.length
    return b.name.length - a.name.length;
  });

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
  const notebook = await findOrCreateNotebook(dendronNote);
  //creates the note
  await importNote(dendronNote.path, notebook);
}

async function importNote(noteDir, inkNotebookId) {

  // get the data from the note
  const noteData = metadataParser(fs.readFileSync(noteDir, "utf-8"));
  const { title, updated, created } = noteData.metadata;

  // Search for existing note with the same title in the same book
  const db = await inkdrop.main.dataStore.getLocalDB();
  const existingNotes = await db.notes.findInBook(inkNotebookId);
  const existingNote = existingNotes.docs.length >= 1 ? existingNotes.docs.find((element) => {
    return element.title === title;
  }) : null;

  // if the note doesn't exist create it
  if (!existingNote) {
    // create the note object
    const note = new Note({
      title: title.slice(0, 60),
      body: noteData.content,
      createdAt: created,
      updatedAt: updated,

    });
    note.bookId = inkNotebookId;

    // save the note
    await note.save();
    await createImageAttachments(noteDir, note);
  }


}

async function createImageAttachments(noteDir, note) {
  const dir = path.dirname(noteDir);
  const resourceDirPath = path.join(dir, "assets/images");
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
  for (let attach of attachments) {
    const { att, original } = attach;
    const target = `assets/images/${original}`;
    newBody = newBody.replace(target, `inkdrop://${att._id}`);
  }
  note.body = newBody;
  await note.save();
}

async function findOrCreateNotebook(dendronNote) {
  let inkNotebookId;

  // get the data from the note
  const noteData = metadataParser(fs.readFileSync(dendronNote.path, "utf-8"));
  const { title, updated, created } = noteData.metadata;
  const body = noteData.content;

  // split the filename to create array of notebooks
  const splitName = dendronNote.name.split(".");

  // deal with root notes
  if (splitName.length === 2) {
    const name = splitName[0];
    const db = await inkdrop.main.dataStore.getLocalDB();
    const notebooks = await db.books.all();
    // look for notebook with name of the note
    const notebook = notebooks.find((element) => {
      return element.name === name && element.parentBookId === null;
    });
    // if it doesnt exist, create it and set inkNotebookId
    if (!notebook) {
      const book = new Book({
        name: name,
        createdAt: created,
        updatedAt: updated
      });
      book.parentBookId = inkNotebookId ? inkNotebookId : null;
      const createdBook = await db.books.put(book)
      inkNotebookId = createdBook.id
    } else {
      inkNotebookId = notebook._id;
    }
  }
  //deal with sub notes
  else {
    const notebookNames = splitName.slice(0, splitName.length - 2);

    for (let [index, name] of notebookNames.entries()) {

      console.log(`processing folder ${name} index: ${index}`);
      const db = await inkdrop.main.dataStore.getLocalDB();
      const notebooks = await db.books.all();
      let foundNotebook
      if (index === 0) {
        foundNotebook = notebooks.filter((element) => {
          return element.name === name && element.parentBookId === null;
        })[0];
      } else {
        foundNotebook = notebooks.filter(element => {
          return element.name === name && element.parentBookId === inkNotebookId;
        })[0];
      }

      // if the notebook exists then return
      if (foundNotebook) {
        inkNotebookId = foundNotebook._id;
      }
      let book;
      book = new Book({
        name: name,
        createdAt: created,
        updatedAt: updated,
      });
      book.parentBookId = inkNotebookId ? inkNotebookId : null;
      if (foundNotebook == undefined) {
        const createdBook = await db.books.put(book)
        inkNotebookId = createdBook.id
      }

    }
  }

  return inkNotebookId;
};
