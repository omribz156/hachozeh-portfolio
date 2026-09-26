import { configureShareImageFontconfig } from './share-image-font.js';

configureShareImageFontconfig();

const sharpModule = await import('sharp');

export default sharpModule.default;
