(function () {
  // Shopify injects a global `Shopify` object with `Shopify.shop` on every
  // storefront page once this script is registered as a ScriptTag.
  var shop = (window.Shopify && window.Shopify.shop) || null;
  if (!shop) return; // not on a Shopify storefront page, bail quietly

  var API_BASE = (function () {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf("/widget.js") !== -1) {
        return scripts[i].src.split("/widget.js")[0];
      }
    }
    return "";
  })();

  var sessionId = getOrCreateSessionId();

  injectStyles();
  var ui = buildUI();
  document.body.appendChild(ui.root);

  function getOrCreateSessionId() {
    try {
      var key = "sai_session_id";
      var existing = window.localStorage.getItem(key);
      if (existing) return existing;
      var id = "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.localStorage.setItem(key, id);
      return id;
    } catch (e) {
      return "s_" + Math.random().toString(36).slice(2);
    }
  }

  function injectStyles() {
    var css = "" +
      "#sai-bubble{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;" +
      "background:#111;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:999999;font-size:26px;border:none;}" +
      "#sai-panel{position:fixed;bottom:92px;right:20px;width:340px;max-width:92vw;height:460px;max-height:70vh;" +
      "background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);display:none;flex-direction:column;" +
      "overflow:hidden;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}" +
      "#sai-panel.open{display:flex;}" +
      "#sai-header{background:#111;color:#fff;padding:14px 16px;font-weight:600;display:flex;justify-content:space-between;align-items:center;}" +
      "#sai-close{cursor:pointer;background:none;border:none;color:#fff;font-size:18px;line-height:1;}" +
      "#sai-messages{flex:1;overflow-y:auto;padding:12px;background:#fafafa;}" +
      ".sai-msg{margin-bottom:10px;max-width:85%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.4;}" +
      ".sai-msg.user{background:#111;color:#fff;margin-left:auto;border-bottom-right-radius:2px;}" +
      ".sai-msg.bot{background:#eee;color:#111;margin-right:auto;border-bottom-left-radius:2px;}" +
      ".sai-products{display:flex;flex-direction:column;gap:8px;margin:6px 0 12px;}" +
      ".sai-product{display:flex;gap:8px;background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:8px;text-decoration:none;color:inherit;}" +
      ".sai-product img{width:48px;height:48px;object-fit:cover;border-radius:6px;background:#f0f0f0;}" +
      ".sai-product .sai-p-title{font-size:13px;font-weight:600;line-height:1.3;}" +
      ".sai-product .sai-p-price{font-size:12px;color:#555;margin-top:2px;}" +
      "#sai-inputrow{display:flex;border-top:1px solid #eee;padding:8px;gap:8px;}" +
      "#sai-input{flex:1;border:1px solid #ddd;border-radius:20px;padding:8px 14px;font-size:14px;outline:none;}" +
      "#sai-send{background:#111;color:#fff;border:none;border-radius:20px;padding:8px 16px;font-size:14px;cursor:pointer;}" +
      "#sai-send:disabled{opacity:.5;cursor:default;}" +
      ".sai-typing{font-size:13px;color:#888;padding:0 4px 8px;}";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildUI() {
    var root = document.createElement("div");

    var bubble = document.createElement("button");
    bubble.id = "sai-bubble";
    bubble.setAttribute("aria-label", "Chat with our shopping assistant");
    bubble.textContent = "💬";

    var panel = document.createElement("div");
    panel.id = "sai-panel";
    panel.innerHTML =
      '<div id="sai-header"><span>Shopping Assistant</span><button id="sai-close" aria-label="Close">✕</button></div>' +
      '<div id="sai-messages"></div>' +
      '<div id="sai-inputrow"><input id="sai-input" type="text" placeholder="What are you looking for?" />' +
      '<button id="sai-send">Send</button></div>';

    root.appendChild(bubble);
    root.appendChild(panel);

    var messagesEl = panel.querySelector("#sai-messages");
    var inputEl = panel.querySelector("#sai-input");
    var sendBtn = panel.querySelector("#sai-send");
    var closeBtn = panel.querySelector("#sai-close");

    var opened = false;
    bubble.addEventListener("click", function () {
      panel.classList.toggle("open");
      if (!opened) {
        opened = true;
        addBotMessage("Hi! Tell me what you're looking for and I'll find some options for you.");
      }
    });
    closeBtn.addEventListener("click", function () {
      panel.classList.remove("open");
    });

    function addUserMessage(text) {
      var div = document.createElement("div");
      div.className = "sai-msg user";
      div.textContent = text;
      messagesEl.appendChild(div);
      scrollToBottom();
    }

    function addBotMessage(text, products) {
      var div = document.createElement("div");
      div.className = "sai-msg bot";
      div.textContent = text;
      messagesEl.appendChild(div);

      if (products && products.length) {
        var wrap = document.createElement("div");
        wrap.className = "sai-products";
        products.forEach(function (p) {
          var a = document.createElement("a");
          a.className = "sai-product";
          a.href = p.url;
          a.target = "_blank";
          a.rel = "noopener";
          a.innerHTML =
            (p.image ? '<img src="' + escapeHtml(p.image) + '" alt="">' : "") +
            '<div><div class="sai-p-title">' + escapeHtml(p.title) + "</div>" +
            (p.price ? '<div class="sai-p-price">$' + escapeHtml(p.price) + "</div>" : "") +
            "</div>";
          wrap.appendChild(a);
        });
        messagesEl.appendChild(wrap);
      }
      scrollToBottom();
    }

    function setTyping(isTyping) {
      var existing = messagesEl.querySelector(".sai-typing");
      if (isTyping && !existing) {
        var div = document.createElement("div");
        div.className = "sai-typing";
        div.textContent = "Thinking…";
        messagesEl.appendChild(div);
        scrollToBottom();
      } else if (!isTyping && existing) {
        existing.remove();
      }
    }

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    async function send() {
      var text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = "";
      sendBtn.disabled = true;
      addUserMessage(text);
      setTyping(true);
      try {
        var res = await fetch(API_BASE + "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop: shop, message: text, sessionId: sessionId }),
        });
        var data = await res.json();
        setTyping(false);
        if (!res.ok) {
          addBotMessage(data.error || "Sorry, something went wrong.");
        } else {
          addBotMessage(data.reply, data.products);
        }
      } catch (e) {
        setTyping(false);
        addBotMessage("Sorry, I couldn't reach the assistant. Please try again in a moment.");
      } finally {
        sendBtn.disabled = false;
        inputEl.focus();
      }
    }

    sendBtn.addEventListener("click", send);
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") send();
    });

    return { root: root };
  }
})();
