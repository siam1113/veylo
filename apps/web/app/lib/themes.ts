export type ThemeId = typeof themes[number]['id'];

export const defaultThemeId = 'clearhead';

// Swatches mirror each theme's --p-* token definitions in styles.css (search `data-theme-name`).
// The non-default themes are from Color Hunt's curated lists: 10 from /palettes/popular,
// then 5 each from /palettes/nature, /palettes/spring, /palettes/sky, /palettes/sea.
export const themes = [
  { id: 'clearhead', name: 'ClearHead', swatch: ['#0a78f5', '#cee4fd', '#e7f1fe', '#011122'] },
  { id: 'dusk-rouge', name: 'Dusk Rouge', swatch: ['#aec4d4', '#f5efe1', '#e5d3af', '#790d16'] },
  { id: 'peach-cream', name: 'Peach Cream', swatch: ['#ffb1b1', '#ffccb8', '#ffdbb0', '#fffad3'] },
  { id: 'crimson-noir', name: 'Crimson Noir', swatch: ['#ff0000', '#bc0202', '#830000', '#000000'] },
  { id: 'sage-blossom', name: 'Sage Blossom', swatch: ['#84a282', '#b8cfb3', '#fefaf3', '#f6e2e9'] },
  { id: 'cotton-candy', name: 'Cotton Candy', swatch: ['#ffe8c4', '#fff4de', '#ffdddd', '#ffced8'] },
  { id: 'amber-cask', name: 'Amber Cask', swatch: ['#4d2a00', '#cc6f00', '#f2a900', '#f9e6a8'] },
  { id: 'orchid-violet', name: 'Orchid Violet', swatch: ['#ffc0de', '#ed96d7', '#c654c3', '#8e1ea2'] },
  { id: 'fern-grove', name: 'Fern Grove', swatch: ['#d1edd3', '#acc5a6', '#89a482', '#5c7057'] },
  { id: 'olive-harvest', name: 'Olive Harvest', swatch: ['#a8bba3', '#97a87a', '#fcf9ea', '#db9558'] },
  { id: 'terracotta', name: 'Terracotta', swatch: ['#fdb773', '#eb895b', '#da6556', '#a14646'] },
  { id: 'forest-amber', name: 'Forest Amber', swatch: ['#f1a344', '#557945', '#5d9253', '#ffcb3d'] },
  { id: 'khaki-trail', name: 'Khaki Trail', swatch: ['#6a795d', '#8e9162', '#b2bd7e', '#d9d28b'] },
  { id: 'woodland-canopy', name: 'Woodland Canopy', swatch: ['#186049', '#4a943e', '#ece8af', '#d98327'] },
  { id: 'autumn-bark', name: 'Autumn Bark', swatch: ['#4c4541', '#f2c46a', '#aeac78', '#fcf0da'] },
  { id: 'meadow-bloom', name: 'Meadow Bloom', swatch: ['#8ea66b', '#fff9d6', '#ffdcdc', '#d8a2a2'] },
  { id: 'spring-blossom', name: 'Spring Blossom', swatch: ['#165823', '#fff2f2', '#ffdada', '#ff788d'] },
  { id: 'garden-pastel', name: 'Garden Pastel', swatch: ['#4d6787', '#7dccad', '#ffea88', '#f599c6'] },
  { id: 'citrus-grove', name: 'Citrus Grove', swatch: ['#ff9d4d', '#ffde4e', '#a1cb35', '#769826'] },
  { id: 'petal-soft', name: 'Petal Soft', swatch: ['#bbf1d2', '#eef8cd', '#ffc5aa', '#ff9d9d'] },
  { id: 'sherbet', name: 'Sherbet', swatch: ['#faffc4', '#ffe1bb', '#ffbda3', '#ff80c7'] },
  { id: 'clear-horizon', name: 'Clear Horizon', swatch: ['#f2f7a0', '#65d0f4', '#578ef5', '#2373f4'] },
  { id: 'sunlit-sky', name: 'Sunlit Sky', swatch: ['#ffd444', '#f4eb6c', '#8acff8', '#006199'] },
  { id: 'daybreak-blue', name: 'Daybreak Blue', swatch: ['#0d47a1', '#2196f3', '#90caf9', '#e3f2fd'] },
  { id: 'dusk-horizon', name: 'Dusk Horizon', swatch: ['#d0e7e6', '#95ccdd', '#4274d9', '#293681'] },
  { id: 'open-sky', name: 'Open Sky', swatch: ['#c4e2f5', '#4bb8fa', '#1591dc', '#2c5ead'] },
  { id: 'seaside-dawn', name: 'Seaside Dawn', swatch: ['#ffefc4', '#97d7ff', '#4d8dba', '#086288'] },
  { id: 'deep-current', name: 'Deep Current', swatch: ['#e8e085', '#2d7495', '#363199', '#030164'] },
  { id: 'tidewater', name: 'Tidewater', swatch: ['#15d8b3', '#49a4bb', '#2e6fa0', '#2f39a9'] },
  { id: 'coral-reef', name: 'Coral Reef', swatch: ['#ffd758', '#fce59a', '#2bbbd7', '#218dae'] },
  { id: 'ocean-mist', name: 'Ocean Mist', swatch: ['#f2efe7', '#c8dfdb', '#66a3bf', '#3368a0'] },
] as const;

export function isThemeId(value: string | null): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}
