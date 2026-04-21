import { useState, useRef, useEffect } from 'react';
import { Upload, Trash2, Plus, Image, Video, Save, Check } from 'lucide-react';
import { mockCarouselSlides, introVideoUrl } from '@/data/mockData';
import { api } from '@/lib/apiClient';
import { SITE_NAME_STORAGE_KEY } from '@/lib/siteName';

type Slide = { id: string; imageUrl: string; title?: string };

const resizeImageBlob = (source: Blob, maxWidth = 1920, quality = 0.92): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(source);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width));
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });

/**
 * Upload a blob via our backend's presigned-PUT endpoint. Returns the
 * public URL (MinIO / S3) with a cache-buster appended so UIs that cache
 * by URL (e.g. the browser image cache) see the new content immediately.
 */
async function uploadViaPresign(blob: Blob, contentType: string): Promise<string> {
  const { uploadUrl, publicUrl } = await api.createCoverPresign({
    kind: 'homepage',
    contentType,
    size: blob.size,
  });
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  });
  if (!putRes.ok) throw new Error(`上傳失敗 (${putRes.status})`);
  return `${publicUrl}?t=${Date.now()}`;
}

const HomepageManagement = () => {
  const [videoUrl, setVideoUrl] = useState(introVideoUrl);
  const [pendingVideoFile, setPendingVideoFile] = useState<File | null>(null);
  const [slides, setSlides] = useState<Slide[]>(mockCarouselSlides);
  const [siteName, setSiteName] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const slideInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const hasUserInteractedRef = useRef(false);

  const pendingSlideFilesRef = useRef<Record<string, File>>({});

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const [slidesEntry, videoEntry, logoEntry, nameEntry] = await Promise.all([
          api.getHomepageSetting<Slide[]>('carousel_slides').catch(() => null),
          api.getHomepageSetting<string>('intro_video').catch(() => null),
          api.getHomepageSetting<string>('site_logo').catch(() => null),
          api.getHomepageSetting<string>('site_name').catch(() => null),
        ]);
        if (hasUserInteractedRef.current) return;

        if (Array.isArray(slidesEntry?.value) && slidesEntry!.value.length > 0) {
          setSlides(slidesEntry!.value);
        }
        const videoVal = videoEntry?.value;
        if (typeof videoVal === 'string' && videoVal) setVideoUrl(videoVal);

        const logoVal = logoEntry?.value;
        if (typeof logoVal === 'string' && logoVal) {
          setLogoPreview(logoVal);
        } else {
          const local = localStorage.getItem('siteLogo');
          if (local) setLogoPreview(local);
        }

        const nameVal = nameEntry?.value;
        if (typeof nameVal === 'string' && nameVal) setSiteName(nameVal);
      } catch (err) {
        console.error('[HomepageManagement] load settings failed', err);
      }
    };
    fetchSettings();
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

  const markInteracted = () => {
    hasUserInteractedRef.current = true;
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
    setSaveError(null);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setLogoPreview(dataUrl);
    markInteracted();
  };

  const removeLogo = () => {
    setLogoPreview(null);
    markInteracted();
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const blobUrl = URL.createObjectURL(file);
    blobUrlRef.current = blobUrl;
    setPendingVideoFile(file);
    setVideoUrl(blobUrl);
    markInteracted();
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  const handleVideoRemove = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPendingVideoFile(null);
    setVideoUrl('');
    markInteracted();
  };

  const handleSlideUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      pendingSlideFilesRef.current[id] = file;
      const previewUrl = URL.createObjectURL(file);
      setSlides((prev) => [...prev, { id, imageUrl: previewUrl }]);
    }
    markInteracted();
    if (slideInputRef.current) slideInputRef.current.value = '';
  };

  const removeSlide = (id: string) => {
    setSlides((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target && target.imageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.imageUrl);
      }
      delete pendingSlideFilesRef.current[id];
      return prev.filter((s) => s.id !== id);
    });
    markInteracted();
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      // --- Logo ---
      let logoUrlToSave: string | null = null;
      if (logoPreview) {
        if (logoPreview.startsWith('data:')) {
          const res = await fetch(logoPreview);
          const blob = await res.blob();
          logoUrlToSave = await uploadViaPresign(blob, blob.type || 'image/png');
        } else {
          logoUrlToSave = logoPreview;
        }
      }
      await api.setHomepageSetting('site_logo', logoUrlToSave);
      if (logoUrlToSave) localStorage.setItem('siteLogo', logoUrlToSave);
      else localStorage.removeItem('siteLogo');
      window.dispatchEvent(new CustomEvent('logoUpdated', { detail: { logoUrl: logoUrlToSave } }));

      // --- Video ---
      let finalVideoUrl = videoUrl;
      if (pendingVideoFile) {
        finalVideoUrl = await uploadViaPresign(
          pendingVideoFile,
          pendingVideoFile.type || 'video/mp4',
        );
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
        setPendingVideoFile(null);
        setVideoUrl(finalVideoUrl);
      }

      // --- Carousel: upload new / migrate legacy base64 ---
      const uploadedSlides: Slide[] = [];
      for (const slide of slides) {
        const pendingFile = pendingSlideFilesRef.current[slide.id];
        if (pendingFile) {
          const blob = await resizeImageBlob(pendingFile);
          const publicUrl = await uploadViaPresign(blob, 'image/jpeg');
          URL.revokeObjectURL(slide.imageUrl);
          uploadedSlides.push({ ...slide, imageUrl: publicUrl });
          delete pendingSlideFilesRef.current[slide.id];
        } else if (slide.imageUrl.startsWith('data:')) {
          const res = await fetch(slide.imageUrl);
          const rawBlob = await res.blob();
          const blob = await resizeImageBlob(rawBlob);
          const publicUrl = await uploadViaPresign(blob, 'image/jpeg');
          uploadedSlides.push({ ...slide, imageUrl: publicUrl });
        } else {
          uploadedSlides.push(slide);
        }
      }

      await Promise.all([
        api.setHomepageSetting('intro_video', finalVideoUrl),
        api.setHomepageSetting('carousel_slides', uploadedSlides),
      ]);
      setSlides(uploadedSlides);

      const nameTrimmed = siteName.trim();
      await api.setHomepageSetting('site_name', nameTrimmed || null);
      if (nameTrimmed) localStorage.setItem(SITE_NAME_STORAGE_KEY, nameTrimmed);
      else localStorage.removeItem(SITE_NAME_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent('siteNameUpdated', { detail: { name: nameTrimmed } }));

      try {
        sessionStorage.removeItem('rq:carousel-slides');
        sessionStorage.removeItem('rq:carousel-slides:ts');
      } catch { /* ignore */ }

      window.dispatchEvent(new Event('carouselUpdated'));
      setHasUnsavedChanges(false);
      setSaveSuccess(true);
    } catch (err) {
      console.error('[HomepageManagement] Save failed:', err);
      setSaveError(err instanceof Error ? err.message : '儲存失敗，請重試');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Global save bar */}
      <div className="flex items-center justify-between bg-card rounded-xl px-5 py-3 shadow-sm">
        <span className={`text-sm ${saveError ? 'text-destructive' : hasUnsavedChanges ? 'text-amber-500' : 'text-muted-foreground'}`}>
          {saveError ?? (hasUnsavedChanges ? '尚有未儲存的變更' : saveSuccess ? '所有變更已儲存' : '')}
        </span>
        <button
          onClick={handleSave}
          disabled={!hasUnsavedChanges || isSaving}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            hasUnsavedChanges
              ? 'bg-action text-action-foreground hover:bg-action/90'
              : 'bg-muted text-muted-foreground cursor-default'
          }`}
        >
          {isSaving ? (
            <><Save className="h-4 w-4 animate-pulse" /> 儲存中...</>
          ) : saveSuccess && !hasUnsavedChanges ? (
            <><Check className="h-4 w-4" /> 已儲存</>
          ) : (
            <><Save className="h-4 w-4" /> 儲存</>
          )}
        </button>
      </div>

      {/* Site name */}
      <div className="bg-card rounded-xl p-6 shadow-sm">
        <h3 className="font-semibold text-foreground mb-4">網站名稱</h3>
        <input
          type="text"
          value={siteName}
          onChange={(e) => {
            setSiteName(e.target.value);
            markInteracted();
          }}
          aria-label="網站名稱"
          className="w-full max-w-md px-4 py-2.5 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
          placeholder="後台登入與側欄標題（未填則顯示「後台管理」）"
        />
      </div>

      {/* Logo */}
      <div className="bg-card rounded-xl p-6 shadow-sm">
        <h3 className="font-semibold text-foreground mb-4">網站 LOGO</h3>
        <div className="flex items-center gap-4">
          {logoPreview ? (
            <div className="relative group">
              <img src={logoPreview} alt="Logo" className="h-16 max-w-[200px] object-contain rounded-lg border border-border p-1" />
              <button
                onClick={removeLogo}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="h-16 w-40 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-muted-foreground">
              <Image className="h-6 w-6" />
            </div>
          )}
          <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          <button
            onClick={() => logoInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-action text-action-foreground text-sm font-medium hover:bg-action/90"
          >
            <Upload className="h-4 w-4" /> 上傳 LOGO
          </button>
        </div>
      </div>

      {/* Video */}
      <div className="bg-card rounded-xl p-6 shadow-sm">
        <h3 className="font-semibold text-foreground mb-4">進場動態影片</h3>
        <div className="flex items-center gap-4">
          <input ref={videoInputRef} type="file" accept="video/*" onChange={handleVideoUpload} className="hidden" />
          <button
            onClick={() => videoInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-action text-action-foreground text-sm font-medium hover:bg-action/90"
          >
            <Video className="h-4 w-4" /> 上傳影片
          </button>
          {videoUrl && (
            <button
              onClick={handleVideoRemove}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" /> 移除
            </button>
          )}
        </div>
        {pendingVideoFile && (
          <p className="mt-2 text-xs text-muted-foreground">已選擇：{pendingVideoFile.name}（儲存後上傳至雲端）</p>
        )}
        {videoUrl && (
          <video src={videoUrl} className="mt-4 w-full max-w-md rounded-lg" controls muted />
        )}
      </div>

      {/* Carousel */}
      <div className="bg-card rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground">輪播大圖 (建議 1920×800 以上)</h3>
          <div>
            <input ref={slideInputRef} type="file" accept="image/*" multiple onChange={handleSlideUpload} className="hidden" />
            <button
              onClick={() => slideInputRef.current?.click()}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-action text-action-foreground text-sm hover:bg-action/90"
            >
              <Plus className="h-4 w-4" /> 上傳圖片
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {slides.map((slide) => (
            <div key={slide.id} className="relative group rounded-lg overflow-hidden aspect-[3/2]">
              <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => removeSlide(slide.id)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HomepageManagement;
