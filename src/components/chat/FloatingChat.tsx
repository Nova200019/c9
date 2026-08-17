import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./FloatingChat.scss";

// Simple icons
const icons = {
  chat: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>,
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  send: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  expand: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
};

export default function FloatingChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  
  // Ref for the view transition API
  const buttonRef = useRef<HTMLButtonElement>(null);
  
  const handleExpand = () => {
    // If browser supports View Transitions API
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        setIsExpanding(true);
        setIsOpen(false);
        navigate("/chat");
      });
    } else {
      // Fallback
      navigate("/chat");
    }
  };

  if (isExpanding || location.pathname === "/chat") return null; // Unmount while transitioning or on full page

  return (
    <div className="floating-chat-container">
      {/* Floating Action Button */}
      <button 
        ref={buttonRef}
        className={`floating-fab ${isOpen ? 'open' : ''} glass-button`}
        onClick={() => setIsOpen(!isOpen)}
        style={{ viewTransitionName: 'chat-morph' }}
      >
        <span className="fab-icon-wrapper">
          {isOpen ? icons.close : icons.chat}
        </span>
        {!isOpen && <div className="fab-glow-ring"></div>}
      </button>

      {/* Mini Chat Panel */}
      <div className={`floating-panel glass-panel ${isOpen ? 'visible' : ''}`}>
        <div className="fp-header">
          <div className="fp-title">
            <span className="fp-status-dot"></span>
            Cloud9 AI
          </div>
          <button className="fp-expand-btn" onClick={handleExpand} title="Open full view">
            {icons.expand}
          </button>
        </div>

        <div className="fp-messages">
          <div className="fp-msg assistant">
            Hi! I'm Cloud9 AI. How can I help you today?
          </div>
        </div>

        <div className="fp-input-area">
          <input 
            type="text" 
            placeholder="Ask me anything..." 
            className="fp-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleExpand();
            }}
          />
          <button className="fp-send-btn" onClick={handleExpand}>
            {icons.send}
          </button>
        </div>
      </div>
    </div>
  );
}
