/* Подпись комплекта в Internet Explorer через AvCMXWebP. ES5. */
(function (window, document) {
  "use strict";

  var BUILD = "20261030c";
  var token = "";
  var session = null;
  var signingBusy = false;
  var chosenPubKeyId = "";

  function qs(name) {
    var search = window.location.search || "";
    var match = new RegExp("[?&]" + name + "=([^&]*)").exec(search);
    return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
  }

  function setStatus(text, kind) {
    var el = document.getElementById("status");
    if (!el) return;
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

  function errText(e) {
    if (!e) return "неизвестная ошибка";
    if (typeof e === "string") return e;
    var parts = [];
    if (e.message) parts.push(e.message);
    if (e.code !== undefined && e.code !== null && e.code !== 0) parts.push("код " + e.code);
    return parts.length ? parts.join(" · ") : String(e);
  }

  function softFlags() {
    var flags = 0;
    try {
      if (typeof AVCMF_IGNORE_CRL_ABSENCE !== "undefined") flags = flags | AVCMF_IGNORE_CRL_ABSENCE;
      if (typeof AVCMF_IGNORE_CRL_EXPIRE !== "undefined") flags = flags | AVCMF_IGNORE_CRL_EXPIRE;
    } catch (e) {}
    return flags;
  }

  function noAuthFlags() {
    var flags = softFlags();
    try {
      if (typeof AVCMF_NO_AUTH !== "undefined") flags = flags | AVCMF_NO_AUTH;
    } catch (e2) {}
    return flags;
  }

  function allCertFlags() {
    try {
      if (typeof AVCMF_ALL_CERT !== "undefined") return AVCMF_ALL_CERT;
    } catch (e) {}
    return 0;
  }

  function pluginNode() {
    return document.getElementById("oavcmx");
  }

  function pluginAlive() {
    var node = pluginNode();
    return !!(node && typeof node.CreateBlob === "function");
  }

  function diagnosePlugin() {
    var lines = [];
    lines.push("сборка страницы: " + BUILD);
    var node = pluginNode();
    lines.push("object#oavcmx: " + (node ? "есть" : "нет"));
    if (node) {
      lines.push("CreateBlob: " + (typeof node.CreateBlob === "function" ? "да" : "нет"));
      try {
        lines.push("Version: " + (node.Version || "—"));
      } catch (e) {
        lines.push("Version: ошибка");
      }
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
    return pluginAlive();
  }

  function api(method, path, body, binary, onOk, onErr) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, path, true);
    if (binary) {
      try {
        xhr.responseType = "arraybuffer";
      } catch (e) {}
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
      c1.innerHTML = (doc.doc_type_label || doc.doc_type || "") +
        "<br/><span class='hint'>" + (doc.file_name || "") + "</span>";
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
    }
  }

  function selectedPubKeyId() {
    if (chosenPubKeyId) return chosenPubKeyId;
    var select = document.getElementById("cert-select");
    if (!select || !select.options.length) return "";
    var opt = select.options[select.selectedIndex];
    return opt ? (opt.getAttribute("data-pub") || "") : "";
  }

  function rememberCert(certs) {
    if (!certs || !certs.length || certs.length() < 1) return "";
    fillCertSelect(certs);
    return selectedPubKeyId();
  }

  /**
   * Выбор сертификата. Сначала диалог авторизации АВЕСТ (окно ключа/пароля),
   * без предварительного selectCerts — он часто даёт «Внутренняя ошибка библиотеки».
   */
  function pickCertificate(done) {
    var existing = selectedPubKeyId();
    if (existing) {
      done(null, existing);
      return;
    }
    if (typeof avcmx !== "function") {
      done("Скрипт avcmxwebp.js не загрузился. Обновите страницу Ctrl+F5 в IE.");
      return;
    }
    if (!pluginAlive()) {
      done(
        "Плагин AvCMXWebP не активен (нет CreateBlob). " +
          "IE x86, сайт в «Надёжные узлы», ActiveX разрешён, AvPass вставлен."
      );
      return;
    }

    setStatus("Открываю окно АВЕСТ — выберите сертификат и введите пароль AvPass…");

    /* Путь 1: авторизация с диалогом (без AVCMF_NO_AUTH) — как в демо АВЕСТ. */
    avcmx().connectionAsync(softFlags(), function (eAuth, connAuth) {
      if (!eAuth && connAuth) {
        try {
          var own = connAuth.ownCert();
          var pub = own.pubKeyId().hex();
          if (pub) {
            chosenPubKeyId = pub;
            try {
              var select = document.getElementById("cert-select");
              while (select.firstChild) select.removeChild(select.firstChild);
              var opt = document.createElement("option");
              opt.value = "0";
              opt.text = own.subjectName ? own.subjectName() : pub;
              opt.setAttribute("data-pub", pub);
              select.add(opt);
            } catch (eFill) {}
            done(null, pub);
            return;
          }
        } catch (eOwn) {
          setStatus("Сессия есть, ownCert недоступен (" + errText(eOwn) + "). Пробую выбор из справочника…");
        }
      } else if (eAuth) {
        setStatus("Авторизация АВЕСТ: " + errText(eAuth) + ". Пробую без входа в контейнер…");
      }

      /* Путь 2: NO_AUTH + диалог выбора сертификатов. */
      avcmx().connectionAsync(noAuthFlags(), function (e, conn) {
        if (e) {
          done(
            "Сессия АВЕСТ не открылась: " + errText(e) +
              ". Проверьте Персональный менеджер сертификатов АВЕСТ, AvPass, IE x86 и СОС."
          );
          return;
        }
        try {
          conn.selectCertsDlgAsync(
            "Выбор сертификата ГосСУОК",
            "Выберите личный сертификат. AvPass должен быть вставлен.",
            allCertFlags(),
            function (e2, dlgCerts) {
              if (e2) {
                tryList(conn, done, "Окно выбора: " + errText(e2));
                return;
              }
              var pub2 = rememberCert(dlgCerts);
              if (pub2) {
                done(null, pub2);
                return;
              }
              tryList(conn, done, "В окне сертификат не выбран.");
            }
          );
        } catch (errDlg) {
          tryList(conn, done, errText(errDlg));
        }
      });
    });
  }

  function tryList(conn, done, prevErr) {
    setStatus((prevErr || "") + " Пробую список личного справочника…");
    try {
      var params = avcmx().params().add(AVCM_TYPE, avcmx().blob().int(AVCM_TYPE_MY));
      var certs = conn.selectCerts(params, allCertFlags());
      var pub = rememberCert(certs);
      if (pub) {
        done(null, pub);
        return;
      }
      done((prevErr ? prevErr + " " : "") + "В личном справочнике нет сертификатов. Откройте менеджер АВЕСТ и проверьте AvPass.");
    } catch (err) {
      done((prevErr ? prevErr + " " : "") + "Справочник: " + errText(err));
    }
  }

  function signOne(doc, pubKeyId, done) {
    setWork("Скачиваю " + (doc.file_name || doc.id) + "…");
    api(
      "GET",
      "/api/v1/ie-sign/" + encodeURIComponent(token) + "/documents/" + doc.id + "/pdf/",
      null,
      true,
      function (buf) {
        var b64 = arrayBufferToBase64(buf);
        setWork("Подписываю " + (doc.file_name || doc.id) + " — при запросе введите пароль AvPass…");
        var login = avcmx().params().add(AVCM_PUB_KEY_ID, avcmx().blob().zttext(pubKeyId));
        var flags = softFlags();
        try {
          if (typeof AVCMF_FORCE_TOKEN_CONTROL !== "undefined") flags = flags | AVCMF_FORCE_TOKEN_CONTROL;
        } catch (eFlag) {}
        avcmx().connectionAsync(login, flags, function (e, conn) {
          if (e) {
            /* без FORCE_TOKEN — иногда носитель уже в сессии */
            avcmx().connectionAsync(login, softFlags(), function (e2, conn2) {
              if (e2) {
                done(errText(e2));
                return;
              }
              doSign(conn2, b64, doc, done);
            });
            return;
          }
          doSign(conn, b64, doc, done);
        });
      },
      function (message) {
        done(message);
      }
    );
  }

  function doSign(conn, b64, doc, done) {
    try {
      var message = conn.message(avcmx().blob().base64(b64));
      var signFlags = AVCMF_DETACHED | AVCMF_ADD_SIGN_CERT | AVCMF_REPEAT_AUTHENTICATION;
      message.signAsync(signFlags, function (err, signed) {
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
  }

  function signPending() {
    if (signingBusy) {
      setStatus("Подпись уже идёт…");
      return;
    }
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

    diagnosePlugin();
    signingBusy = true;
    setStatus("Шаг 1/" + pending.length + ": выбор сертификата AvPass…");

    pickCertificate(function (pickErr, pub) {
      if (pickErr || !pub) {
        signingBusy = false;
        setStatus(pickErr || "Сертификат не выбран.", "err");
        return;
      }
      setStatus("Подпись " + pending.length + " документ(ов) сертификатом…", "ok");
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
          api(
            "POST",
            "/api/v1/ie-sign/" + encodeURIComponent(token) + "/sign/",
            { signatures: signatures },
            false,
            function (data) {
              signingBusy = false;
              setWork("");
              setStatus("Подписи сохранены. Закройте IE и в Chrome нажмите «Собрать архив».", "ok");
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
        setStatus("Подпись документа " + (index + 1) + " из " + pending.length + "…");
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

  function checkPluginOnly() {
    diagnosePlugin();
    if (typeof avcmx !== "function") {
      setStatus("Нет avcmxwebp.js. Ctrl+F5 или перезалейте /ie-sign/ на сервер.", "err");
      return;
    }
    if (!pluginAlive()) {
      setStatus(
        "CreateBlob нет — плагин в странице не активен. IE x86, надёжные узлы, ActiveX, AvPass.",
        "err"
      );
      return;
    }
    setStatus(
      "Плагин виден (сборка " + BUILD + "). Нажмите «Подписать документы AvPass» — откроется окно АВЕСТ.",
      "ok"
    );
  }

  function reloadSession() {
    setStatus("Обновляю список документов…");
    api(
      "GET",
      "/api/v1/ie-sign/" + encodeURIComponent(token) + "/",
      null,
      false,
      function (data) {
        showSession(data);
        setStatus("Список обновлён.", "ok");
      },
      function (message) {
        setStatus(message, "err");
      }
    );
  }

  function safeCall(fn, label) {
    return function () {
      try {
        fn();
      } catch (e) {
        var msg = label + ": " + errText(e);
        setStatus(msg, "err");
        try {
          window.alert(msg);
        } catch (e2) {}
      }
    };
  }

  window.onPluginLoaded = function () {
    diagnosePlugin();
    setStatus("Плагин сообщил onload. Можно подписывать (сборка " + BUILD + ").", "ok");
  };

  window.reloadPlugin = safeCall(checkPluginOnly, "Проверка плагина");
  window.signPending = safeCall(signPending, "Подпись");
  window.reloadSession = safeCall(reloadSession, "Обновление");

  window.onload = function () {
    token = qs("t");
    diagnosePlugin();
    if (!token) {
      setStatus("В ссылке нет ticket. В Chrome на карточке нажмите «Подпись в Internet Explorer».", "err");
      return;
    }
    api(
      "GET",
      "/api/v1/ie-sign/" + encodeURIComponent(token) + "/",
      null,
      false,
      function (data) {
        showSession(data);
        diagnosePlugin();
        if (pluginAlive()) {
          setStatus(
            "Комплект загружен. Сборка " + BUILD + ". Нажмите «Подписать документы AvPass» — окно АВЕСТ с ключом.",
            "ok"
          );
        } else {
          setStatus(
            "Комплект загружен, но CreateBlob нет. IE x86 + надёжные узлы + ActiveX. Сборка " + BUILD + ".",
            "err"
          );
        }
      },
      function (message) {
        setStatus(message, "err");
      }
    );
  };
}(window, document));
