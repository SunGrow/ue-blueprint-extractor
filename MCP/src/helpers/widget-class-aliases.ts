const WIDGET_CLASS_ALIASES: Record<string, string> = {
  'button': 'CommonButtonBase', 'text': 'TextBlock', 'image': 'Image',
  'vbox': 'VerticalBox', 'hbox': 'HorizontalBox', 'canvas': 'CanvasPanel',
  'overlay': 'Overlay', 'scroll': 'ScrollBox', 'border': 'Border',
  'spacer': 'Spacer', 'activatable': 'CommonActivatableWidget', 'size_box': 'SizeBox',
  'rich_text': 'RichTextBlock', 'progress': 'ProgressBar', 'slider': 'Slider',
  'check': 'CheckBox', 'throbber': 'Throbber', 'wrap_box': 'WrapBox',
  'grid': 'GridPanel', 'uniform_grid': 'UniformGridPanel', 'scale_box': 'ScaleBox',
};

export function resolveWidgetClassAlias(className: string): string {
  return WIDGET_CLASS_ALIASES[className.toLowerCase()] ?? className;
}

export function getAvailableWidgetClassAliases(): Record<string, string> {
  return { ...WIDGET_CLASS_ALIASES };
}
