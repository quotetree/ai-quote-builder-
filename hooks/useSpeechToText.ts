import { useState, useEffect, useRef, useCallback } from 'react';

interface UseSpeechToTextResult {
  isRecording: boolean;
  isSupported: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  toggleRecording: () => void;
}

export function useSpeechToText(onResult: (text: string) => void): UseSpeechToTextResult {
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const onResultRef = useRef(onResult);

  // Keep onResult ref up to date
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    // Check if Speech Recognition is supported
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true; // Keep listening until stopped
      recognition.interimResults = true; // Get results as they come
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';
        
        // Loop through all results
        for (let i = 0; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }

        // Send whatever we have - interim or final
        const textToSend = (finalTranscript + interimTranscript).trim();
        if (textToSend) {
          onResultRef.current(textToSend);
        }
      };

      recognition.onerror = (event: any) => {
        // Only log non-aborted errors (aborted is normal when we stop manually)
        if (event.error !== 'aborted') {
          console.error('Speech recognition error:', event.error);
        }
        setIsRecording(false);
        
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          // Permission denied
          console.warn('Microphone permission denied');
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }

    // Cleanup on unmount
    return () => {
      if (recognitionRef.current && isRecording) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore errors on cleanup
        }
      }
    };
  }, []); // Only run once on mount

  const startRecording = useCallback(() => {
    if (!recognitionRef.current || !isSupported) {
      return;
    }

    try {
      recognitionRef.current.start();
      setIsRecording(true);
    } catch (error: any) {
      // If already started, ignore
      if (error.name !== 'InvalidStateError') {
        console.error('Failed to start recognition:', error);
      }
    }
  }, [isSupported]);

  const stopRecording = useCallback(() => {
    if (!recognitionRef.current) {
      return;
    }

    try {
      recognitionRef.current.stop();
      setIsRecording(false);
    } catch (error) {
      console.error('Failed to stop recognition:', error);
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  return {
    isRecording,
    isSupported,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}

