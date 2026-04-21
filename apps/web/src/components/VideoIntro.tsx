import { useState, useEffect, useRef, useCallback } from 'react';
import { introVideoUrl } from '@/data/mockData';
import { api } from '@/lib/apiClient';

const VideoIntro = () => {
  const [show, setShow] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    api
      .getHomepageSetting<string>('intro_video')
      .then((entry) => {
        const v = entry?.value;
        if (typeof v === 'string' && v.trim()) {
          setSrc(v);
        } else {
          setSrc(introVideoUrl);
        }
      })
      .catch(() => setSrc(introVideoUrl));
  }, []);

  const handleEnd = useCallback(() => {
    setFadeOut(true);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => setShow(false), 800);
  }, []);

  useEffect(() => {
    if (!src) return;
    const timer = setTimeout(handleEnd, 6000);
    return () => clearTimeout(timer);
  }, [handleEnd, src]);

  if (!show || src === null) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-primary transition-opacity duration-700 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
      onClick={handleEnd}
    >
      <video
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover animate-zoom-in-slow"
        onEnded={handleEnd}
      >
        <source src={src} type="video/mp4" />
      </video>
      <button
        onClick={handleEnd}
        className="absolute bottom-8 right-8 px-4 py-2 rounded-lg bg-action text-action-foreground text-sm font-medium hover:bg-action/90 transition-opacity"
      >
        略過
      </button>
    </div>
  );
};

export default VideoIntro;
