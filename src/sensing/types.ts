export const KEYPOINTS = [
  'nose', 'left_eye', 'right_eye', 'left_ear_base', 'right_ear_base',
  'left_ear_tip', 'right_ear_tip', 'chin', 'throat', 'withers',
] as const
export type KeypointName = (typeof KEYPOINTS)[number]
export const KP = Object.fromEntries(KEYPOINTS.map((k, i) => [k, i])) as Record<KeypointName, number>

/** All coordinates normalized 0..1 in camera-frame space (un-mirrored). */
export interface Keypoint { x: number; y: number; c: number }
export interface DogPose { box: { x: number; y: number; w: number; h: number }; score: number; kpts: Keypoint[] }
export interface PoseFrame { t: number; pose: DogPose | null; inferMs: number }

export type Presence = 'absent' | 'present' | 'attending' | 'touching'
export type Arousal = 'calm' | 'alert' | 'worked-up'
