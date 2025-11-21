# Speech-to-Text Chat Input & Upload Removal

## Changes Made

### 1. Removed File Upload from Chat Bar
**File**: `components/SplitChatPanel.tsx`

**Removed:**
- The "+" (Plus) button that previously appeared in the chat input bar
- All associated click handlers and upload logic from the chat input

**Result:**
- Cleaner, simpler chat input interface
- No file upload option from the chat bar (file uploads remain available elsewhere in the app)
- Layout remains balanced with textarea, mic button, and send button

### 2. Implemented Speech-to-Text

**New File**: `hooks/useSpeechToText.ts`

Created a custom React hook that provides speech-to-text functionality using the Web Speech API.

**Features:**
- Uses `SpeechRecognition` or `webkitSpeechRecognition` (browser compatibility)
- Continuous listening mode - keeps recording until stopped
- Real-time interim results
- Automatic cleanup on component unmount
- Error handling for permission denials

**Hook Interface:**
```typescript
interface UseSpeechToTextResult {
  isRecording: boolean;      // Current recording state
  isSupported: boolean;       // Browser support detection
  startRecording: () => void; // Start listening
  stopRecording: () => void;  // Stop listening
  toggleRecording: () => void;// Toggle recording state
}
```

**Updated**: `components/SplitChatPanel.tsx`

**Speech-to-Text Integration:**
```typescript
const handleSpeechResult = (text: string) => {
  // Append recognized text to existing input
  setInput(prevInput => {
    const trimmedPrev = prevInput.trim();
    return trimmedPrev ? `${trimmedPrev} ${text}` : text;
  });
};

const { isRecording, isSupported: isSpeechSupported, toggleRecording } = useSpeechToText(handleSpeechResult);
```

## User Experience

### Microphone Button Behavior

**When Supported:**
1. **Click once** → Starts recording
   - Button turns red with pulsing animation
   - User speaks
   - Recognized text appears in the message input field
   - Text appends to existing input (with space separator)

2. **Click again** → Stops recording
   - Button returns to normal gray state
   - User can continue typing or send the message

**When NOT Supported:**
- Click shows toast message: "Speech-to-text is not supported in this browser"
- Button remains inactive
- No crash or errors

### Visual States

**Normal State** (not recording):
- Gray microphone icon
- Hover effect (light gray background)
- Tooltip: "Start voice input"

**Recording State** (active):
- Red background with white mic icon
- Pulsing animation (`animate-pulse`)
- Tooltip: "Stop recording"

### Important Notes

1. **Text Insertion, Not Auto-Send:**
   - Speech recognition only fills the text input
   - User must click the Send button to actually send the message
   - This allows users to review/edit before sending

2. **Permission Handling:**
   - First use will request microphone permission
   - If denied, recording stops and errors are logged
   - No intrusive error messages (graceful degradation)

3. **Continuous Recognition:**
   - Keeps listening until user stops it
   - Multiple speech segments are appended with spaces
   - Works well for longer dictation

## Browser Compatibility

**Supported Browsers:**
- Chrome/Edge (full support)
- Safari (webkit prefix support)
- Opera

**Not Supported:**
- Firefox (no Web Speech API)
- IE11

The hook includes feature detection and fails gracefully on unsupported browsers.

## Technical Details

### Speech Recognition Configuration
```typescript
recognition.continuous = true;      // Keep listening until stopped
recognition.interimResults = true;  // Get real-time updates
recognition.lang = 'en-US';         // English language
```

### Event Handlers
- `onresult`: Processes recognized speech and appends to input
- `onerror`: Handles errors (permission denied, network issues, etc.)
- `onend`: Resets recording state when recognition stops

### Cleanup
- Recognition is properly stopped when component unmounts
- No memory leaks or dangling event listeners
- Ref-based management ensures stable recognition instance

## Testing

### Test Speech-to-Text:
1. Open a project
2. Click the microphone button in the chat input
3. ✅ Button should turn red and pulse
4. Speak a message (e.g., "Add 10 security cameras to the quote")
5. ✅ Text should appear in the input field
6. Click the mic again to stop
7. ✅ Button returns to gray
8. Click Send to send the message

### Test Unsupported Browser:
1. Open in Firefox (or simulate unsupported environment)
2. Click the microphone button
3. ✅ Toast message appears: "Speech-to-text is not supported in this browser"
4. ✅ No crash or console errors

### Test Text Appending:
1. Type "Hello" in the input
2. Click mic and say "World"
3. ✅ Input should show "Hello World"
4. Multiple speech segments append correctly with spaces

## Files Modified

1. **hooks/useSpeechToText.ts** (NEW)
   - Custom React hook for Web Speech API
   - ~120 lines

2. **components/SplitChatPanel.tsx**
   - Added import for `useSpeechToText`
   - Added `handleSpeechResult` function
   - Added hook usage with state
   - Removed Plus button from chat input
   - Updated Mic button with onClick handler and visual states
   - ~20 lines changed

## Future Enhancements

Potential improvements for future iterations:
- Language selection (currently hardcoded to 'en-US')
- Interim results display (show what's being recognized in real-time)
- Voice activity detection (visual feedback while speaking)
- Alternative speech services (Google Cloud Speech, Azure, etc.)
- Keyboard shortcut to start/stop recording (e.g., Ctrl+Shift+M)

