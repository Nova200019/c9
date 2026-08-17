import { useState } from "react";
import Header from "../Header/Header";
import MainSection from "../MainSection/MainSection";
import Uploader from "../Uploader/Uploader";
import { useAppSelector } from "../../hooks/store";
import { ToastContainer } from "react-toastify";
import ChatPage from "../ChatPage/ChatPage";
import "../ChatPage/ChatPage.scss";

const Homepage = () => {
  const showUploader = useAppSelector(
    (state) => state.uploader.uploads.length !== 0
  );
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div>
      <div className="">
        <Header />
        <div className="flex space-between">
          <MainSection />
          {showUploader && <Uploader />}
        </div>
      </div>

      <ToastContainer position="bottom-left" pauseOnFocusLoss={false} />

      {/* Floating AI chat button */}
      {!chatOpen && (
        <button
          className="chat-float-btn"
          onClick={() => setChatOpen(true)}
          title="Open Cloud9 AI"
          id="open-ai-chat-btn"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
            {/* AI sparkle icon */}
            <path d="M0 0h24v24H0z" fill="none"/>
          </svg>
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ position: "absolute" }}>
            <path d="M12 1L9.5 8.5 2 9.27l5.46 5.13L5.82 22 12 18.27 18.18 22l-1.64-7.6L22 9.27l-7.5-.77z"/>
          </svg>
        </button>
      )}

      {/* Full-screen chat overlay */}
      {chatOpen && (
        <ChatPage onClose={() => setChatOpen(false)} />
      )}
    </div>
  );
};

export default Homepage;
