// The hook of the extension's icon, as an SVG in the text colour (currentColor):
// on the button, the « Signalé » badge and the dialogs' banner. Same drawing as icons/icon.svg.

const SVG = 'http://www.w3.org/2000/svg';

export function hookIcon() {
  const svg = node('svg', { viewBox: '18 0 56 80', class: 'gpr-hook', 'aria-hidden': 'true', focusable: 'false' });
  const group = node('g', { transform: 'translate(-2 4)', fill: 'none', stroke: 'currentColor' });
  group.append(
    node('path', { d: 'M59 17 V-4', 'stroke-width': '5', 'stroke-linecap': 'round' }),
    node('circle', { cx: '59', cy: '26', r: '6.5', 'stroke-width': '9' }),
    node('path', { d: 'M59 32 V56 A14 14 0 0 1 31 56 V46', 'stroke-width': '9' }),
    node('path', { d: 'M26.5 57 V32 L44 52 L35.5 46 V57 Z', fill: 'currentColor', stroke: 'none' }),
  );
  svg.append(group);
  return svg;
}

function node(tag, attributes) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
