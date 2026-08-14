import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  destructiveButtonStyle,
  menuTriggerButtonStyle,
  policyUiTokens,
  secondaryButtonStyle
} from './policyUiStyles.js';

const styles = {
  wrapper: {
    position: 'relative',
    display: 'inline-flex'
  },
  trigger: {
    ...menuTriggerButtonStyle
  },
  menu: {
    position: 'fixed',
    minWidth: 176,
    border: `1px solid ${policyUiTokens.borderColor}`,
    borderRadius: policyUiTokens.surfaceRadius,
    background: policyUiTokens.surfaceBackground,
    boxShadow: policyUiTokens.shadowOverlay,
    padding: '0.3rem',
    display: 'grid',
    gap: '0.2rem',
    zIndex: 40
  },
  menuButton: {
    ...secondaryButtonStyle,
    border: 'none',
    borderRadius: 4,
    padding: '0.5rem 0.65rem',
    textAlign: 'left',
    fontWeight: 500
  },
  destructiveMenuButton: {
    ...destructiveButtonStyle,
    border: 'none',
    borderTop: `1px solid ${policyUiTokens.borderColor}`,
    borderRadius: 4,
    padding: '0.6rem 0.65rem 0.5rem',
    textAlign: 'left',
    marginTop: '0.15rem'
  }
};

function resolveMenuPosition(triggerRect, menuRect) {
  const viewportPadding = 12;
  const gap = 8;
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  const openUpward = spaceBelow < menuRect.height + gap && triggerRect.top > spaceBelow;

  const top = openUpward
    ? Math.max(viewportPadding, triggerRect.top - menuRect.height - gap)
    : Math.min(window.innerHeight - menuRect.height - viewportPadding, triggerRect.bottom + gap);

  const left = Math.min(
    Math.max(viewportPadding, triggerRect.right - menuRect.width),
    window.innerWidth - menuRect.width - viewportPadding
  );

  return {
    top,
    left,
    transformOrigin: openUpward ? 'bottom right' : 'top right'
  };
}

function PolicyActionMenu({ items, label = 'Policy actions', disabled = false }) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, transformOrigin: 'top right' });

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current || !menuRef.current) {
      return;
    }

    const updatePosition = () => {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const menuRect = menuRef.current.getBoundingClientRect();
      setPosition(resolveMenuPosition(triggerRect, menuRect));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !menuRef.current) {
      return;
    }

    const firstButton = menuRef.current.querySelector('button');
    firstButton?.focus();
  }, [isOpen]);

  return (
    <span style={styles.wrapper}>
      <button
        ref={triggerRef}
        type="button"
        style={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        disabled={disabled}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
      >
        {'\u2026'}
      </button>
      {isOpen ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={{
            ...styles.menu,
            top: position.top,
            left: position.left,
            transformOrigin: position.transformOrigin
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={disabled || item.disabled}
              style={item.destructive ? styles.destructiveMenuButton : styles.menuButton}
              onClick={() => {
                setIsOpen(false);
                item.onSelect();
                triggerRef.current?.focus();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      ) : null}
    </span>
  );
}

export default PolicyActionMenu;
