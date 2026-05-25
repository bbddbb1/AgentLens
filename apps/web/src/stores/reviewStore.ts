/**
 * Review store — manages review and comment state.
 */

import { create } from 'zustand';

export interface Review {
  id: string;
  mission_id: string;
  author_id?: string;
  status: 'pending' | 'approved' | 'changes_requested' | 'rejected';
  body?: string;
  created_at: string;
  updated_at: string;
  comment_count?: number;
}

export interface Comment {
  id: string;
  review_id?: string;
  mission_id: string;
  author_id?: string;
  parent_id?: string;
  body: string;
  target_type?: 'node' | 'edge' | 'region' | 'span';
  target_id?: string;
  target_context?: Record<string, unknown>;
  resolved: boolean;
  created_at: string;
  replies?: Comment[];
}

interface ReviewStore {
  reviews: Review[];
  comments: Comment[];
  activeCommentTarget: { type: string; id: string } | null;
  isCommentPanelOpen: boolean;

  setReviews: (reviews: Review[]) => void;
  setComments: (comments: Comment[]) => void;
  addComment: (comment: Comment) => void;
  setActiveCommentTarget: (target: { type: string; id: string } | null) => void;
  setCommentPanelOpen: (open: boolean) => void;
  resolveComment: (id: string) => void;
}

export const useReviewStore = create<ReviewStore>((set) => ({
  reviews: [],
  comments: [],
  activeCommentTarget: null,
  isCommentPanelOpen: true,

  setReviews: (reviews) => set({ reviews }),
  setComments: (comments) => set({ comments }),
  addComment: (comment) =>
    set((state) => ({ comments: [...state.comments, comment] })),
  setActiveCommentTarget: (target) => set({ activeCommentTarget: target }),
  setCommentPanelOpen: (open) => set({ isCommentPanelOpen: open }),
  resolveComment: (id) =>
    set((state) => ({
      comments: state.comments.map((c) =>
        c.id === id ? { ...c, resolved: true } : c
      ),
    })),
}));
