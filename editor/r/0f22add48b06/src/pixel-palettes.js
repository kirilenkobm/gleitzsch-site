// Generated from shared/pixel-palettes.json. Do not change palette order.
export const PixelPalette = Object.freeze({ CLASSIC: 0, ARCADE: 1, QUEST: 2, CANDY: 3, EMBER: 4 });
export const PixelPalettes = Object.freeze([{"id": "classic", "name": "Classic"}, {"id": "arcade", "name": "Arcade"}, {"id": "quest", "name": "Quest"}, {"id": "candy", "name": "Candy"}, {"id": "ember", "name": "Ember 32"}].map(Object.freeze));
export const pixelPalette = (value) => Number.isInteger(value) && value >= 0 && value < PixelPalettes.length ? value : PixelPalette.CLASSIC;
