'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export function Tooltip({ 
  content, 
  children, 
  side = 'top',
  delay = 0.08 
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    Promise.resolve().then(() => setMounted(true));
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const gap = 12;
    const viewportPadding = 12;

    let top = rect.top + rect.height / 2;
    let left = rect.left + rect.width / 2;

    if (side === 'top') {
      top = rect.top - gap;
    } else if (side === 'bottom') {
      top = rect.bottom + gap;
    } else if (side === 'left') {
      left = rect.left - gap;
    } else if (side === 'right') {
      left = rect.right + gap;
    }

    if (side === 'top' || side === 'bottom') {
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - viewportPadding));
    } else {
      top = Math.max(viewportPadding, Math.min(top, window.innerHeight - viewportPadding));
    }

    setPosition({ top, left });
  }, [side]);

  useEffect(() => {
    if (!isVisible) return;

    updatePosition();

    const handle = () => updatePosition();
    window.addEventListener('resize', handle);
    window.addEventListener('scroll', handle, true);
    return () => {
      window.removeEventListener('resize', handle);
      window.removeEventListener('scroll', handle, true);
    };
  }, [isVisible, updatePosition]);

  const arrowClasses: Record<string, string> = {
    top: 'bottom-[-6px] left-1/2 -translate-x-1/2 border-l-[7px] border-r-[7px] border-t-[7px] border-l-transparent border-r-transparent',
    bottom: 'top-[-6px] left-1/2 -translate-x-1/2 border-l-[7px] border-r-[7px] border-b-[7px] border-l-transparent border-r-transparent',
    left: 'right-[-6px] top-1/2 -translate-y-1/2 border-t-[7px] border-b-[7px] border-l-[7px] border-t-transparent border-b-transparent',
    right: 'left-[-6px] top-1/2 -translate-y-1/2 border-t-[7px] border-b-[7px] border-r-[7px] border-t-transparent border-b-transparent',
  };

  return (
    <div className="inline-block" ref={triggerRef} onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => setIsVisible(false)}>
      <div>
        {children}
      </div>

      {mounted && createPortal(
        <AnimatePresence>
          {isVisible && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 4 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, y: 4 }}
              transition={{ duration: 0.16, delay }}
              className="fixed z-[99999] pointer-events-none"
              style={{ top: position.top, left: position.left }}
            >
              <div
                className="relative w-[min(22rem,72vw)] min-w-[12rem] rounded-[18px] border border-white/10 bg-[#121524]/96 px-4 py-3 text-[#e8eaf0] shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur-xl ring-1 ring-white/5"
                style={{
                  transform:
                    side === 'top'
                      ? 'translate(-50%, -100%)'
                      : side === 'bottom'
                        ? 'translate(-50%, 0%)'
                        : side === 'left'
                          ? 'translate(-100%, -50%)'
                          : 'translate(0%, -50%)',
                }}
              >
                <div className="mb-1.5 flex items-center gap-2 text-[10px] tracking-[0.14em] text-[#9aa0bc]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#818cf8] shadow-[0_0_0_3px_rgba(129,140,248,0.1)]" />
                  Full text
                </div>
                <p className="max-h-[min(14rem,36vh)] overflow-auto text-[13px] leading-[1.7] text-[#f3f4f6] whitespace-pre-wrap break-words pr-1">
                  {content}
                </p>
                <div className={`absolute ${arrowClasses[side]} border-[#121524]/96`} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
