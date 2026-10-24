// Core domain models. Stable UUIDs are the identity of every entity;
// file paths are internal references only and never shown to users.

export type Point = { x: number; y: number };
/** Corners in order: top-left, top-right, bottom-right, bottom-left. Normalised 0..1 of the source image. */
export type Quad = [Point, Point, Point, Point];

export type FilterType = 'original' | 'auto' | 'color' | 'grayscale' | 'bw';
export type Rotation = 0 | 90 | 180 | 270;
export type OcrStatus = 'none' | 'queued' | 'running' | 'done' | 'failed' | 'stale';
export type SourceType = 'camera' | 'image' | 'pdf';

export interface OcrWord {
  t: string;
  /** Normalised bounding box in the processed page image. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type MarkupOp =
  | { id: string; kind: 'ink'; color: string; width: number; points: [number, number][]; highlighter?: boolean }
  | { id: string; kind: 'text'; x: number; y: number; text: string; size: number; color: string }
  | { id: string; kind: 'signature'; x: number; y: number; w: number; h: number; strokes: [number, number][][]; color: string }
  | { id: string; kind: 'redact'; x: number; y: number; w: number; h: number };

export interface PageEdits {
  quad: Quad | null;
  rotation: Rotation;
  filter: FilterType;
  brightness: number; // -100..100
  contrast: number; // -100..100
}

export interface Page {
  id: string;
  documentId: string;
  position: number;
  originalPath: string;
  processedPath: string | null;
  thumbPath: string | null;
  /** Dimensions of the original image (after EXIF orientation). */
  width: number;
  height: number;
  /** Dimensions of the processed image. */
  outWidth: number;
  outHeight: number;
  edits: PageEdits;
  markup: MarkupOp[];
  ocrText: string | null;
  ocrWords: OcrWord[] | null;
  ocrLanguage: string | null;
  ocrStatus: OcrStatus;
  /** Accepted = user tapped "Keep page". Unaccepted pages belong to an in-progress capture. */
  accepted: boolean;
  /** Size of the stored original. */
  originalBytes: number;
  /** Original + processed + thumbnail. */
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentRecord {
  id: string;
  title: string;
  folderId: string | null;
  tagIds: string[];
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  favorite: boolean;
  ocrStatus: OcrStatus;
  thumbPath: string | null;
  deletedAt: number | null;
  /** Drafts are scan sessions that have not been saved yet; they are recoverable after termination. */
  draft: boolean;
  sourceType: SourceType;
  sizeBytes: number;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  icon: string;
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: string;
  name: string;
}

export type ThemePref = 'system' | 'light' | 'dark';
export type QualityPreset = 'small' | 'balanced' | 'high';
export type PageSizePreset = 'auto' | 'a4' | 'letter' | 'legal';

export interface AppSettings {
  onboarded: boolean;
  theme: ThemePref;
  reducedMotion: boolean;
  reducedTransparency: boolean;
  defaultFilter: FilterType;
  autoCapture: boolean;
  /** Open the crop/filter review after every capture (off = fast batch scanning). */
  reviewAfterCapture: boolean;
  autoOcr: boolean;
  ocrLanguages: string[];
  exportQuality: QualityPreset;
  exportPageSize: PageSizePreset;
  exportOcrLayer: boolean;
  haptics: boolean;
  lockEnabled: boolean;
  lockBiometric: boolean;
  /** Seconds in background before relocking. 0 = immediately. */
  autoLockSeconds: number;
  hideInSwitcher: boolean;
  trashRetentionDays: number;
  libraryView: 'grid' | 'list';
  librarySort: SortKey;
  cameraExplained: boolean;
}

export type SortKey = 'newest' | 'oldest' | 'name' | 'size' | 'modified';

export const DEFAULT_SETTINGS: AppSettings = {
  onboarded: false,
  theme: 'system',
  reducedMotion: false,
  reducedTransparency: false,
  defaultFilter: 'auto',
  autoCapture: true,
  reviewAfterCapture: true,
  autoOcr: false,
  ocrLanguages: ['eng'],
  exportQuality: 'balanced',
  exportPageSize: 'auto',
  exportOcrLayer: true,
  haptics: true,
  lockEnabled: false,
  lockBiometric: false,
  autoLockSeconds: 30,
  hideInSwitcher: true,
  trashRetentionDays: 30,
  libraryView: 'grid',
  librarySort: 'newest',
  cameraExplained: false,
};

export const DEFAULT_EDITS: PageEdits = {
  quad: null,
  rotation: 0,
  filter: 'auto',
  brightness: 0,
  contrast: 0,
};

export const FILTER_LABELS: Record<FilterType, string> = {
  original: 'Original',
  auto: 'Auto',
  color: 'Color',
  grayscale: 'Grayscale',
  bw: 'B & W',
};

export const FOLDER_COLORS = ['#4C5FD5', '#1F8A70', '#C2410C', '#B42318', '#7C3AED', '#0E7490', '#A16207', '#475467'];
export const FOLDER_ICONS = ['folder', 'briefcase', 'receipt', 'id', 'school', 'home', 'heart', 'star'];
