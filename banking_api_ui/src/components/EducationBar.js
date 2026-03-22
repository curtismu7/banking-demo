// banking_api_ui/src/components/EducationBar.js
import React, { useState, useRef, useEffect } from 'react';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';
import './EducationBar.css';

/**
 * Global learn pill bar for authenticated users (below main header area).
 */
export default function EducationBar() {
  const { open } = useEducationUI();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const openCiba = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('education-open-ciba', { detail: { tab: 'what' } }));
    }
    setMenuOpen(false);
  };

  return (
    <div className="edu-bar" role="navigation" aria-label="Learn topics">
      <div className="edu-bar-inner">
        <div className="edu-bar-group" ref={menuRef}>
          <button
            type="button"
            className="edu-bar-button dropdown"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
          >
            OAuth Flows ▾
          </button>
          {menuOpen && (
            <div className="edu-bar-dropdown" role="menu">
              <button type="button" role="menuitem" onClick={() => { open(EDU.LOGIN_FLOW, 'what'); setMenuOpen(false); }}>
                Authorization Code + PKCE
              </button>
              <button type="button" role="menuitem" onClick={() => { open(EDU.LOGIN_FLOW, 'ciba'); setMenuOpen(false); }}>
                CIBA (OOB) — short (drawer)
              </button>
              <button type="button" role="menuitem" onClick={() => { openCiba(); }}>
                CIBA — full guide (floating)
              </button>
              <button type="button" role="menuitem" onClick={() => { open(EDU.TOKEN_EXCHANGE, 'why'); setMenuOpen(false); }}>
                Token Exchange (RFC 8693)
              </button>
            </div>
          )}
        </div>
        <button type="button" className="edu-bar-button" onClick={() => open(EDU.TOKEN_EXCHANGE, 'why')}>
          Token Exchange
        </button>
        <button type="button" className="edu-bar-button" onClick={() => open(EDU.MAY_ACT, 'what')}>
          may_act / act
        </button>
        <button type="button" className="edu-bar-button" onClick={() => open(EDU.LOGIN_FLOW, 'pkce')}>
          PKCE
        </button>
        <button type="button" className="edu-bar-button" onClick={openCiba}>
          CIBA
        </button>
        <button type="button" className="edu-bar-button" onClick={() => open(EDU.MCP_PROTOCOL, 'what')}>
          MCP Protocol
        </button>
        <button type="button" className="edu-bar-button" onClick={() => open(EDU.INTROSPECTION, 'why')}>
          Introspection
        </button>
        <button type="button" className="edu-bar-button" onClick={() => open(EDU.AGENT_GATEWAY, 'overview')}>
          Agent Gateway
        </button>
        <button type="button" className="edu-bar-button" onClick={() => open(EDU.RFC_INDEX, 'index')}>
          RFC Index
        </button>
      </div>
    </div>
  );
}
