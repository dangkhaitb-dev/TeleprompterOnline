// read-text-file.js — read a File/Blob as text via FileReader, promisified.
// Used by the home page for .txt / .md script uploads.

export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsText(file);
  });
}
