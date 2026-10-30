/* Подпись комплекта в Internet Explorer через AvCMXWebP. ES5. */
(function (window, document) {
  "use strict";

  var token = "";
  var session = null;
  var pluginReady = false;

  function qs(name) {
    var search = window.location.search || "";
    var match = new RegExp("[?&]" + name + "=([^&]*)").exec(search);
    return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
  }

  function setStatus(text, kind) {
    var el = document.getElementById("status");
    el.className = "status" + (kind ? " " + kind : "");
    el.innerHTML = text;
  }

  function setWork(text) {
    var el = document.getElementById("work");
    if (el) el.innerHTML = text || "";
  }

  function api(method, path, body, binary, onOk, onErr) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, path, true);
    if (binary) {
      xhr.responseType = "arraybuffer";
    } else if (method !== "GET") {
      xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        if (binary) {
          onOk(xhr.response);
          return;
        }
        var data = null;
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch (e) {
          onErr("Ответ сервера не JSON");
          return;
        }
        onOk(data);
        return;
      }
      var message = "Ошибка HTTP " + xhr.status;
      try {
        var err = JSON.parse(xhr.responseText || "{}");
        if (err.error && err.error.message) message = err.error.message;
        else if (err.detail) message = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
        else if (err.message) message = err.message;
      } catch (e2) {}
      onErr(message);
    };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var chunk = 0x8000;
    var binary = "";
    var i;
    for (i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return window.btoa(binary);
  }

  function showSession(data) {
    session = data;
    document.getElementById("meta").style.display = "block";
    document.getElementById("claim-id").innerHTML = String(data.claim_id || "");
    document.getElementById("account").innerHTML = String(data.account || "");
    document.getElementById("debtor").innerHTML = String(data.debtor || "");
    document.getElementById("user").innerHTML = String(data.user || "");
    document.getElementById("docs-box").style.display = "block";
    renderDocs(data.documents || []);
  }

  function renderDocs(docs) {
    var tbody = document.getElementById("docs-table").tBodies[0];
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    var i;
    for (i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var tr = document.createElement("tr");
      var c1 = document.createElement("td");
      c1.innerHTML = (doc.doc_type_label || doc.doc_type || "") + "<br/><span class='hint'>" + (doc.file_name || "") + "</span>";
      var c2 = document.createElement("td");
      c2.innerHTML = doc.signer_label || doc.signer || "";
      var c3 = document.createElement("td");
      c3.innerHTML = doc.has_signature
        ? "<span class='badge-ok'>есть</span>"
        : "<span class='badge-wait'>нет</span>";
      tr.appendChild(c1);
      tr.appendChild(c2);
      tr.appendChild(c3);
      tbody.appendChild(tr);
    }
    if (!docs.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 3;
      td.innerHTML = "Нет PDF для подписи по этой ссылке.";
      empty.appendChild(td);
      tbody.appendChild(empty);
    }
  }

  function loadCerts() {
    try {
      avcmx().connectionAsync(AVCMF_NO_AUTH, function (e, conn) {
        if (e) {
          setStatus("Плагин найден, но не открыл справочник: " + (e.message || e), "err");
          return;
        }
        try {
          var certs = conn.selectCerts(avcmx().params().add(AVCM_TYPE, avcmx().blob().int(AVCM_TYPE_MY)));
          var select = document.getElementById("cert-select");
          while (select.firstChild) select.removeChild(select.firstChild);
          var i;
          for (i = 0; i < certs.length(); i++) {
            var opt = document.createElement("option");
            opt.value = String(i);
            opt.text = certs.certs(i).subjectName();
            opt.setAttribute("data-pub", certs.certs(i).pubKeyId().hex());
            select.add(opt);
          }
          document.getElementById("plugin-box").style.display = "block";
          if (!certs.length()) {
            setStatus("Плагин загружен, но в личном справочнике нет сертификата. Вставьте AvPass.", "err");
          } else {
            setStatus("Плагин AvCMXWebP готов. Выберите сертификат и подпишите документы без ЭЦП.", "ok");
          }
          pluginReady = true;
        } catch (err) {
          setStatus(err.message || String(err), "err");
        }
      });
    } catch (err2) {
      setStatus(
        "Плагин AvCMXWebP не загрузился. Откройте страницу в Internet Explorer (не Chrome/Edge), " +
          "установите комплект АВЕСТ для AvPass. " + (err2.message || ""),
        "err"
      );
    }
  }

  function selectedPubKeyId() {
    var select = document.getElementById("cert-select");
    if (!select || !select.options.length) return "";
    var opt = select.options[select.selectedIndex];
    return opt ? opt.getAttribute("data-pub") || "" : "";
  }

  function signOne(doc, pubKeyId, done) {
    setWork("Скачиваю " + (doc.file_name || doc.id) + "…");
    api("GET", "/api/v1/ie-sign/" + encodeURIComponent(token) + "/documents/" + doc.id + "/pdf/", null, true,
      function (buf) {
        var b64 = arrayBufferToBase64(buf);
        setWork("Подписываю " + (doc.file_name || doc.id) + "…");
        var login = avcmx().params().add(AVCM_PUB_KEY_ID, avcmx().blob().zttext(pubKeyId));
        avcmx().connectionAsync(login, function (e, conn) {
          if (e) {
            done(e.message || String(e));
            return;
          }
          try {
            var message = conn.message(avcmx().blob().base64(b64));
            message.signAsync(AVCMF_DETACHED | AVCMF_ADD_SIGN_CERT | AVCMF_REPEAT_AUTHENTICATION, function (err, signed) {
              if (err) {
                done(err.message || String(err));
                return;
              }
              try {
                done(null, { doc_id: doc.id, pkcs7: signed.val().base64() });
              } catch (ex) {
                done(ex.message || String(ex));
              }
            });
          } catch (ex2) {
            done(ex2.message || String(ex2));
          }
        });
      },
      function (message) { done(message); }
    );
  }

  function signPending() {
    if (!pluginReady) {
      setStatus("Сначала дождитесь загрузки плагина AvCMXWebP.", "err");
      return;
    }
    if (!session || !session.documents || !session.documents.length) {
      setStatus("Нет документов для подписи.", "err");
      return;
    }
    var pub = selectedPubKeyId();
    if (!pub) {
      setStatus("Выберите сертификат.", "err");
      return;
    }
    var pending = [];
    var i;
    for (i = 0; i < session.documents.length; i++) {
      if (!session.documents[i].has_signature) pending.push(session.documents[i]);
    }
    if (!pending.length) {
      setStatus("Все документы по этой ссылке уже подписаны.", "ok");
      return;
    }
    var signatures = [];
    var index = 0;

    function next(err) {
      if (err) {
        setWork("");
        setStatus(err, "err");
        return;
      }
      if (index >= pending.length) {
        setWork("Сохраняю подписи на сервере…");
        api("POST", "/api/v1/ie-sign/" + encodeURIComponent(token) + "/sign/", { signatures: signatures }, false,
          function (data) {
            setWork("");
            setStatus("Подписи сохранены в деле. Можно закрыть IE и продолжить в основном ПМ (собрать архив).", "ok");
            if (data.session) showSession(data.session);
          },
          function (message) {
            setWork("");
            setStatus(message, "err");
          }
        );
        return;
      }
      signOne(pending[index], pub, function (signErr, row) {
        if (signErr) {
          next(signErr);
          return;
        }
        signatures.push(row);
        index += 1;
        next(null);
      });
    }

    next(null);
  }

  function reloadSession() {
    setStatus("Обновляю список документов…");
    api("GET", "/api/v1/ie-sign/" + encodeURIComponent(token) + "/", null, false,
      function (data) {
        showSession(data);
        setStatus("Список обновлён.", "ok");
      },
      function (message) { setStatus(message, "err"); }
    );
  }

  window.onPluginLoaded = function () {
    loadCerts();
  };

  window.signPending = signPending;
  window.reloadSession = reloadSession;

  window.onload = function () {
    token = qs("t");
    if (!token) {
      setStatus("В ссылке нет ticket. На карточке дела в Chrome нажмите «Подпись в Internet Explorer» и откройте выданную ссылку в IE.", "err");
      return;
    }
    api("GET", "/api/v1/ie-sign/" + encodeURIComponent(token) + "/", null, false,
      function (data) {
        showSession(data);
        setStatus("Комплект загружен. Ожидание плагина AvCMXWebP…");
        // Если onload плагина не сработал (IE/ActiveX), пробуем сами через секунду.
        window.setTimeout(function () {
          if (!pluginReady) loadCerts();
        }, 800);
      },
      function (message) { setStatus(message, "err"); }
    );
  };
}(window, document));
