/* Подпись комплекта в Internet Explorer через AvCMXWebP. ES5. */
(function (window, document) {
  "use strict";

  var token = "";
  var session = null;
  var pluginReady = false;
  var signingBusy = false;
  var chosenPubKeyId = "";

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

  function setDiag(text) {
    var el = document.getElementById("diag");
    if (el) el.innerHTML = text || "";
  }

  function api(method, path, body, binary, onOk, onErr) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, path, true);
    if (binary) {
      try { xhr.responseType = "arraybuffer"; } catch (e) {}
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

  function errText(e) {
    if (!e) return "неизвестная ошибка";
    if (typeof e === "string") return e;
    var parts = [];
    if (e.message) parts.push(e.message);
    if (e.code !== undefined && e.code !== null) parts.push("код " + e.code);
    return parts.length ? parts.join(" · ") : String(e);
  }

  function diagnosePlugin() {
    var lines = [];
    var node = document.getElementById("oavcmx");
    lines.push("object#oavcmx: " + (node ? "есть" : "нет"));
    if (node) {
      lines.push("CreateBlob: " + (typeof node.CreateBlob === "function" ? "да" : "нет"));
      try { lines.push("Version: " + (node.Version || "—")); } catch (e) { lines.push("Version: ошибка"); }
    }
    lines.push("avcmx(): " + (typeof avcmx === "function" ? "да" : "нет"));
    try {
      if (window.ActiveXObject) {
        try {
          var ax = new ActiveXObject("AVEST.AvCMXWebP");
          lines.push("ActiveX AVEST.AvCMXWebP: " + (ax && typeof ax.CreateBlob === "function" ? "да" : "создан без API"));
        } catch (e2) {
          lines.push("ActiveX AVEST.AvCMXWebP: нет (" + (e2.message || e2) + ")");
        }
      } else {
        lines.push("ActiveXObject: нет (не IE?)");
      }
    } catch (e3) {
      lines.push("ActiveX проверка: " + (e3.message || e3));
    }
    lines.push("UA: " + (navigator.userAgent || ""));
    setDiag(lines.join("<br/>"));
    return node && typeof node.CreateBlob === "function";
  }

  function showSession(data) {
    session = data;
    document.getElementById("meta").style.display = "block";
    document.getElementById("claim-id").innerHTML = String(data.claim_id || "");
    document.getElementById("account").innerHTML = String(data.account || "");
    document.getElementById("debtor").innerHTML = String(data.debtor || "");
    document.getElementById("user").innerHTML = String(data.user || "");
    document.getElementById("docs-box").style.display = "block";
    document.getElementById("plugin-box").style.display = "block";
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

  function fillCertSelect(certs) {
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
    if (certs.length() > 0) {
      chosenPubKeyId = certs.certs(0).pubKeyId().hex();
      pluginReady = true;
    }
  }

  function connectFlags() {
    var flags = AVCMF_NO_AUTH;
    try {
      if (typeof AVCMF_IGNORE_CRL_ABSENCE !== "undefined") flags = flags | AVCMF_IGNORE_CRL_ABSENCE;
      if (typeof AVCMF_IGNORE_CRL_EXPIRE !== "undefined") flags = flags | AVCMF_IGNORE_CRL_EXPIRE;
    } catch (e) {}
    return flags;
  }

  function selectedPubKeyId() {
    if (chosenPubKeyId) return chosenPubKeyId;
    var select = document.getElementById("cert-select");
    if (!select || !select.options.length) return "";
    var opt = select.options[select.selectedIndex];
    return opt ? (opt.getAttribute("data-pub") || "") : "";
  }

  /** Открыть сессию и выбрать сертификат (список или диалог АВЕСТ). */
  function pickCertificate(done) {
    var existing = selectedPubKeyId();
    if (existing) {
      done(null, existing);
      return;
    }
    if (typeof avcmx !== "function") {
      done("Обёртка avcmx не загрузилась. Обновите страницу в IE.");
      return;
    }
    if (!diagnosePlugin()) {
      done(
        "Плагин AvCMXWebP в IE не активирован (нет CreateBlob). " +
          "Добавьте сайт в «Надёжные узлы», разрешите ActiveX, откройте IE x86, вставьте AvPass."
      );
      return;
    }
    setStatus("Открываю сессию АВЕСТ…");
    avcmx().connectionAsync(connectFlags(), function (e, conn) {
      if (e) {
        done("Сессия АВЕСТ: " + errText(e) + ". Вставьте AvPass и разрешите ActiveX для этого сайта.");
        return;
      }
      try {
        var params = avcmx().params().add(AVCM_TYPE, avcmx().blob().int(AVCM_TYPE_MY));
        var certs = conn.selectCerts(params);
        if (certs && certs.length && certs.length() > 0) {
          fillCertSelect(certs);
          done(null, selectedPubKeyId());
          return;
        }
      } catch (err) {
        setStatus("Список недоступен (" + errText(err) + "), открываю окно выбора АВЕСТ…");
      }
      try {
        conn.selectCertsDlgAsync(
          "Выбор сертификата ГосСУОК",
          "Выберите личный сертификат. Носитель AvPass должен быть вставлен.",
          0,
          function (e2, dlgCerts) {
            if (e2) {
              done("Окно выбора сертификата: " + errText(e2));
              return;
            }
            try {
              if (!dlgCerts || !dlgCerts.length || dlgCerts.length() < 1) {
                done("Сертификат не выбран.");
                return;
              }
              fillCertSelect(dlgCerts);
              done(null, selectedPubKeyId());
            } catch (err3) {
              done(errText(err3));
            }
          }
        );
      } catch (err4) {
        done(errText(err4));
      }
    });
  }

  function signOne(doc, pubKeyId, done) {
    setWork("Скачиваю " + (doc.file_name || doc.id) + "…");
    api("GET", "/api/v1/ie-sign/" + encodeURIComponent(token) + "/documents/" + doc.id + "/pdf/", null, true,
      function (buf) {
        var b64 = arrayBufferToBase64(buf);
        setWork("Подписываю " + (doc.file_name || doc.id) + " — введите пароль AvPass, если спросит…");
        var login = avcmx().params().add(AVCM_PUB_KEY_ID, avcmx().blob().zttext(pubKeyId));
        avcmx().connectionAsync(login, function (e, conn) {
          if (e) {
            done(errText(e));
            return;
          }
          try {
            var message = conn.message(avcmx().blob().base64(b64));
            message.signAsync(AVCMF_DETACHED | AVCMF_ADD_SIGN_CERT | AVCMF_REPEAT_AUTHENTICATION, function (err, signed) {
              if (err) {
                done(errText(err));
                return;
              }
              try {
                done(null, { doc_id: doc.id, pkcs7: signed.val().base64() });
              } catch (ex) {
                done(errText(ex));
              }
            });
          } catch (ex2) {
            done(errText(ex2));
          }
        });
      },
      function (message) { done(message); }
    );
  }

  function signPending() {
    if (signingBusy) return;
    if (!session || !session.documents || !session.documents.length) {
      setStatus("Нет документов для подписи.", "err");
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
    signingBusy = true;
    setStatus("Выбор сертификата…");
    pickCertificate(function (pickErr, pub) {
      if (pickErr || !pub) {
        signingBusy = false;
        setStatus(pickErr || "Сертификат не выбран.", "err");
        return;
      }
      pluginReady = true;
      setStatus("Подпись " + pending.length + " документ(ов)…", "ok");
      var signatures = [];
      var index = 0;

      function next(err) {
        if (err) {
          signingBusy = false;
          setWork("");
          setStatus(err, "err");
          return;
        }
        if (index >= pending.length) {
          setWork("Сохраняю подписи на сервере…");
          api("POST", "/api/v1/ie-sign/" + encodeURIComponent(token) + "/sign/", { signatures: signatures }, false,
            function (data) {
              signingBusy = false;
              setWork("");
              setStatus("Подписи сохранены в деле. Закройте IE и в Chrome нажмите «Собрать архив».", "ok");
              if (data.session) showSession(data.session);
            },
            function (message) {
              signingBusy = false;
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
    });
  }

  function loadCerts() {
    setStatus("Диагностика плагина…");
    diagnosePlugin();
    if (typeof avcmx !== "function") {
      setStatus("Скрипт avcmxwebp.js не загрузился.", "err");
      return;
    }
    if (!diagnosePlugin()) {
      setStatus(
        "Плагин в странице не активен. В IE: шестерёнка → свойства обозревателя → безопасность → надёжные узлы → добавить http://этот-сервер. Разрешите ActiveX. Откройте IE x86 и вставьте AvPass. Затем «Повторить» или сразу «Подписать документы AvPass».",
        "err"
      );
      return;
    }
    setStatus("Плагин виден. Можно нажать «Подписать документы AvPass» — откроется выбор сертификата.");
    pickCertificate(function (err, pub) {
      if (err) {
        setStatus(err, "err");
        return;
      }
      setStatus("Сертификат выбран. Нажмите «Подписать документы AvPass».", "ok");
    });
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
    setStatus("Событие onload плагина получено…");
    diagnosePlugin();
  };

  window.reloadPlugin = function () {
    pluginReady = false;
    chosenPubKeyId = "";
    loadCerts();
  };

  window.signPending = signPending;
  window.reloadSession = reloadSession;

  window.onload = function () {
    token = qs("t");
    diagnosePlugin();
    if (!token) {
      setStatus("В ссылке нет ticket. В Chrome на карточке нажмите «Подпись в Internet Explorer».", "err");
      return;
    }
    api("GET", "/api/v1/ie-sign/" + encodeURIComponent(token) + "/", null, false,
      function (data) {
        showSession(data);
        setStatus("Комплект загружен. Нажмите «Подписать документы AvPass» — откроется окно АВЕСТ (ключ/пароль).");
        window.setTimeout(function () {
          diagnosePlugin();
          if (typeof avcmx === "function" && document.getElementById("oavcmx") &&
              typeof document.getElementById("oavcmx").CreateBlob === "function") {
            setStatus("Комплект и плагин на месте. Можно подписывать.", "ok");
          }
        }, 1000);
      },
      function (message) { setStatus(message, "err"); }
    );
  };
}(window, document));
