// Stable, concise analytics taxonomy for the Teleprompter studio.
// Keep action names under 27 chars so `teleprompter_${action}` stays within
// Firebase's 40-character event-name limit without truncation.

const CLICK_ACTIONS = [
  ['.app-header .logo-btn', 'logoClick'],
  ['.app-header .back-btn', 'backClick'],
  ['#formatToolbar .ft-bold', 'boldClick'],
  ['#formatToolbar .ft-italic', 'italicClick'],
  ['#formatToolbar .ft-underline', 'underlineClick'],
  ['#fontColorApplyBtn', 'applyColorClick'],
  ['#fontColorTrigger', 'colorPickerClick'],
  ['#formatToolbar [data-align="justify"]', 'alignJustifyClick'],
  ['#formatToolbar [data-align="left"]', 'alignLeftClick'],
  ['#formatToolbar [data-align="center"]', 'alignCenterClick'],
  ['#formatToolbar [data-align="right"]', 'alignRightClick'],
  ['#exitPlaybackButton', 'exitPlaybackClick'],
  ['#restartReadingButton', 'restartReadingClick'],
  ['#pauseButton', 'pauseResumeClick'],
  ['#headerPlayButton', 'playPauseClick'],
  ['#recordButton', 'recordClick'],
  ['#mobileFormatToolbar .ft-bold', 'mobileBoldClick'],
  ['#mobileFormatToolbar .ft-italic', 'mobileItalicClick'],
  ['#mobileFormatToolbar .ft-underline', 'mobileUnderlineClick'],
  ['#mobileFormatToolbar .ft-color', 'mobileApplyColorClick'],
  ['#mobileFormatToolbar .ft-color-picker-btn', 'mobileColorPickerClick'],
  ['#mobileFormatToolbar [data-align="justify"]', 'mobileJustifyClick'],
  ['#mobileFormatToolbar [data-align="left"]', 'mobileAlignLeftClick'],
  ['#mobileFormatToolbar [data-align="center"]', 'mobileAlignCenterClick'],
  ['#mobileFormatToolbar [data-align="right"]', 'mobileAlignRightClick'],
  ['#mffMoreLeft', 'formatScrollLeftClick'],
  ['#mffMore', 'formatScrollRightClick'],
  ['#closePanel', 'closePanelClick'],
  ['#playBtn', 'panelPlayClick'],
  ['#panelEditButton', 'panelEditClick'],
  ['#barThemeBtn', 'panelThemeClick'],
  ['[data-action="Prompter"]', 'prompterToggleClick'],
  ['#mirrorControl', 'mirrorTextClick'],
  ['#notchControl', 'notchModeClick'],
  ['#layoutControl', 'layoutGuidesClick'],
  ['#speedControl', 'scrollMenuClick'],
  ['#settingsControl', 'settingsMenuClick'],
  ['[data-layout-edge="left"]', 'layoutLeftClick'],
  ['[data-layout-edge="right"]', 'layoutRightClick'],
  ['#layoutEyeLine', 'eyeLineClick'],
  ['#speedModeAuto', 'autoScrollClick'],
  ['#speedMethodWpm', 'fixedSpeedClick'],
  ['#speedMethodTime', 'scrollTimeClick'],
  ['#shortcutsControl', 'shortcutsClick'],
  ['#cameraSettingsRow', 'cameraSettingsClick'],
  ['#micSettingsRow', 'micSettingsClick'],
  ['#themeLightBtn', 'lightThemeClick'],
  ['#themeDarkBtn', 'darkThemeClick'],
  ['#cameraMenuAction', 'cameraActionClick'],
  ['#micMenuAction', 'micActionClick'],
  ['.m-tab[data-tab="main"]', 'recordTabClick'],
  ['.m-tab[data-tab="tools"]', 'toolsTabClick'],
  ['#notchEditBtn', 'notchEditClick'],
  ['#notchEditToolbar [data-cmd="bold"]', 'notchBoldClick'],
  ['#notchEditToolbar [data-cmd="italic"]', 'notchItalicClick'],
  ['#notchEditToolbar [data-cmd="underline"]', 'notchUnderlineClick'],
  ['#notchEditColorApplyBtn', 'notchApplyColorClick'],
  ['#notchEditColorTrigger', 'notchColorPickerClick'],
  ['#notchEditToolbar [data-align="justify"]', 'notchJustifyClick'],
  ['#notchEditToolbar [data-align="left"]', 'notchAlignLeftClick'],
  ['#notchEditToolbar [data-align="center"]', 'notchAlignCenterClick'],
  ['#notchEditToolbar [data-align="right"]', 'notchAlignRightClick'],
];

const CHANGE_ACTIONS = [
  ['#fontSizeSelect', 'fontSizeChange'],
  ['#formatToolbar .ft-line-height', 'lineHeightChange'],
  ['#mobileFormatToolbar .ft-font-size', 'mobileFontSizeChange'],
  ['#mobileFormatToolbar .ft-line-height', 'mobileLineHeightChange'],
  ['#speedRange', 'scrollSpeedChange'],
  ['#speedInput', 'scrollWpmChange'],
  ['#scrollTimeRange', 'scrollDurationChange'],
  ['#scrollMinutes', 'scrollMinChange'],
  ['#scrollSeconds', 'scrollSecChange'],
  ['#toggleCountdown', 'countdownChange'],
  ['#toggleFullscreen', 'fullscreenChange'],
  ['#toggleNotchFullscreen', 'notchFullscreenChange'],
  ['#toggleCamera', 'cameraToggleChange'],
  ['#toggleMic', 'micToggleChange'],
  ['#notchEditFontSize', 'notchFontSizeChange'],
  ['#notchEditLineHeight', 'notchLineHeightChange'],
];

function applyNames(root, rules) {
  rules.forEach(([selector, actionName]) => {
    root.querySelectorAll(selector).forEach((control) => {
      control.dataset.analyticsName = actionName;
    });
  });
}

export function nameTeleprompterAnalyticsControls(root = document) {
  applyNames(root, CLICK_ACTIONS);
  applyNames(root, CHANGE_ACTIONS);
}

export const TELEPROMPTER_CLICK_ACTIONS = CLICK_ACTIONS;
export const TELEPROMPTER_CHANGE_ACTIONS = CHANGE_ACTIONS;
