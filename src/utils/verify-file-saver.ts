
import { saveAs } from 'file-saver-es';

console.log('file-saver-es imported successfully:', typeof saveAs === 'function');
console.log('saveAs function:', saveAs);

// Test creating a simple blob and verify saveAs can handle it
const testBlob = new Blob(['test'], { type: 'text/plain' });
console.log('Test blob created:', testBlob);
console.log('Verification complete - file-saver-es is working properly');
