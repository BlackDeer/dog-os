"""Train on datasets that annotate different keypoint subsets.

Dog-Pose (StanfordExtra) never annotates eyes, throat or withers: those columns are v=0 in every
label file. AP-10K annotates eyes and nose but no ears or chin. If both are mixed naively, the keypoint
*visibility* loss teaches the model "eyes are invisible" on every Dog-Pose image.

Convention used in ml/datasets/*/labels/train:
    v = 0  annotated as not visible / out of frame     -> visibility target 0, no location loss
    v = 1|2 annotated                                   -> visibility target 1, location loss
    v = 3  this source never annotates this keypoint    -> NO visibility loss, NO location loss
           (x,y are parked at the box centre so augmentation does not push them out of frame,
            which would turn them into v=0)
Val labels never contain v=3 (the validator would treat it as annotated).

patch() swaps Ultralytics' pose keypoint loss for one that honours v=3. Written against
ultralytics 8.4.x (v8PoseLoss / PoseLoss26.calculate_keypoints_loss).
"""
from __future__ import annotations

import torch
import torch.nn.functional as F

UNKNOWN = 3


def _kpt_losses(self, masks, target_gt_idx, keypoints, batch_idx, stride_tensor, target_bboxes, pred_kpts):
    from ultralytics.utils.ops import xyxy2xywh
    selected = self._select_target_keypoints(keypoints, batch_idx, target_gt_idx, masks)
    kpts_loss, kpts_obj_loss, rle_loss = 0, 0, 0
    if masks.any():
        target_bboxes /= stride_tensor
        gt_kpt = selected[masks]
        gt_kpt[..., :2] /= stride_tensor.view(1, -1).expand(masks.shape[0], -1)[masks][:, None, None]
        area = xyxy2xywh(target_bboxes[masks])[:, 2:].prod(1, keepdim=True)
        pred_kpt = pred_kpts[masks]
        v = gt_kpt[..., 2]
        known = v != UNKNOWN
        kpt_mask = (v != 0) & known                                  # annotated -> location loss
        kpts_loss = self.keypoint_loss(pred_kpt, gt_kpt, kpt_mask, area)
        rle = getattr(self, "rle_loss", None)
        if rle is not None and pred_kpt.shape[-1] in (4, 5):
            rle_loss = self.calculate_rle_loss(pred_kpt, gt_kpt, kpt_mask).clamp(min=0)
        if pred_kpt.shape[-1] in (3, 5):
            bce = F.binary_cross_entropy_with_logits(pred_kpt[..., 2], kpt_mask.float(), reduction="none")
            kpts_obj_loss = (bce * known).sum() / known.sum().clamp(min=1)
    return kpts_loss, kpts_obj_loss, rle_loss


def patch():
    from ultralytics.utils import loss as L

    def v8(self, *a, **k):
        return _kpt_losses(self, *a, **k)[:2]

    L.v8PoseLoss.calculate_keypoints_loss = v8
    if hasattr(L, "PoseLoss26"):
        L.PoseLoss26.calculate_keypoints_loss = _kpt_losses
