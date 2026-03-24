import { isPlainObject } from './formatting.js';

const commonUIButtonStyleBrushFields = [
  ['normal', 'NormalBase'],
  ['normal_hovered', 'NormalHovered'],
  ['normal_pressed', 'NormalPressed'],
  ['selected', 'SelectedBase'],
  ['selected_hovered', 'SelectedHovered'],
  ['selected_pressed', 'SelectedPressed'],
  ['disabled', 'Disabled'],
] as const;

const commonUIButtonTextStyleFields = [
  ['normal', 'NormalTextStyle'],
  ['normal_hovered', 'NormalHoveredTextStyle'],
  ['selected', 'SelectedTextStyle'],
  ['selected_hovered', 'SelectedHoveredTextStyle'],
  ['disabled', 'DisabledTextStyle'],
] as const;

const commonUIButtonPaddingFields = [
  ['button', 'ButtonPadding'],
  ['custom', 'CustomPadding'],
  ['min_width', 'MinWidth'],
  ['min_height', 'MinHeight'],
  ['max_width', 'MaxWidth'],
  ['max_height', 'MaxHeight'],
] as const;

export function normalizeCommonUIButtonStyleInput(style: unknown): Record<string, unknown> {
  const stylePayload = isPlainObject(style) ? style : {};
  const classDefaults: Record<string, unknown> = {};

  for (const [styleKey, classDefaultKey] of commonUIButtonStyleBrushFields) {
    if (styleKey in stylePayload) {
      classDefaults[classDefaultKey] = stylePayload[styleKey];
    }
  }

  const textStyles = isPlainObject(stylePayload.text_styles) ? stylePayload.text_styles : null;
  if (textStyles) {
    for (const [styleKey, classDefaultKey] of commonUIButtonTextStyleFields) {
      if (styleKey in textStyles) {
        classDefaults[classDefaultKey] = textStyles[styleKey];
      }
    }
  }

  const padding = isPlainObject(stylePayload.padding) ? stylePayload.padding : null;
  if (padding) {
    for (const [styleKey, classDefaultKey] of commonUIButtonPaddingFields) {
      if (styleKey in padding) {
        classDefaults[classDefaultKey] = padding[styleKey];
      }
    }
  }

  if (typeof stylePayload.single_material === 'boolean') {
    classDefaults.bSingleMaterial = stylePayload.single_material;
  } else if (isPlainObject(stylePayload.single_material)) {
    const singleMaterial = stylePayload.single_material;
    if (typeof singleMaterial.enabled === 'boolean') {
      classDefaults.bSingleMaterial = singleMaterial.enabled;
    }
    if ('brush' in singleMaterial) {
      classDefaults.SingleMaterialBrush = singleMaterial.brush;
    }
  }

  if ('single_material_brush' in stylePayload) {
    classDefaults.SingleMaterialBrush = stylePayload.single_material_brush;
  }

  return classDefaults;
}

export function extractCommonUIButtonStyle(classDefaults: unknown): Record<string, unknown> {
  const defaults = isPlainObject(classDefaults) ? classDefaults : {};
  const style: Record<string, unknown> = {};

  for (const [styleKey, classDefaultKey] of commonUIButtonStyleBrushFields) {
    if (classDefaultKey in defaults) {
      style[styleKey] = defaults[classDefaultKey];
    }
  }

  const textStyles: Record<string, unknown> = {};
  for (const [styleKey, classDefaultKey] of commonUIButtonTextStyleFields) {
    if (classDefaultKey in defaults) {
      textStyles[styleKey] = defaults[classDefaultKey];
    }
  }
  if (Object.keys(textStyles).length > 0) {
    style.text_styles = textStyles;
  }

  const padding: Record<string, unknown> = {};
  for (const [styleKey, classDefaultKey] of commonUIButtonPaddingFields) {
    if (classDefaultKey in defaults) {
      padding[styleKey] = defaults[classDefaultKey];
    }
  }
  if (Object.keys(padding).length > 0) {
    style.padding = padding;
  }

  if ('bSingleMaterial' in defaults || 'SingleMaterialBrush' in defaults) {
    style.single_material = {
      ...(typeof defaults.bSingleMaterial === 'boolean' ? { enabled: defaults.bSingleMaterial } : {}),
      ...('SingleMaterialBrush' in defaults ? { brush: defaults.SingleMaterialBrush } : {}),
    };
  }

  return style;
}
