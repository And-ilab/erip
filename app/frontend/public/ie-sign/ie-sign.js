/* Подпись комплекта в Internet Explorer через AvCMXWebP. ES5. */
(function (window, document) {
  "use strict";

  var BUILD = "20261030f";
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

  function isProtectedModeError(e) {
    if (!e || e.code === undefined || e.code === null) return false;
    var u = e.code >>> 0;
    var low = u & 0xff;
    return u === 3895066916 || u === 3895066900 || low === 0x24 || low === 0x14;
  }

  function errText(e) {
    if (!e) return "неизвестная ошибка";
    if (typeof e === "string") return e;
    var parts = [];
    if (e.message) parts.push(e.message);
    if (e.code !== undefined && e.code !== null && e.code !== 0) parts.push("код " + (e.code >>> 0));
    var base = parts.length ? parts.join(" · ") : String(e);
    if (isProtectedModeError(e)) {
      base +=
        " (Защищённый режим IE / Low Integrity блокирует доступ AvCryptMail.dll к %APPDATA%\\Avest: " +
        "в «Надёжные узлы» снимите галочку «Для всех узлов этой зоны требуется проверка серверов (https:)», " +
        "добавьте http-адрес сервера, отключите «Защищённый режим» и перезапустите IE)";
    }
    return base;
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
    try {
      if (typeof AVCMF_NO_AUTH !== "undefined") return AVCMF_NO_AUTH;
    } catch (e2) {}
    return 4;
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

  /**
   * В IE у методов ActiveX typeof часто "unknown" или "object", а не "function".
   * Version уже есть (1.1.x) — плагин поднят; CreateBlob проверяем вызовом.
   */
  function activeXCallable(obj, name) {
    if (!obj) return false;
    var t;
    try {
      t = typeof obj[name];
    } catch (e) {
      return false;
    }
    if (t === "function" || t === "unknown" || t === "object") return true;
    try {
      return obj[name] != null;
    } catch (e2) {
      return false;
    }
  }

  function probeCreateBlob() {
    var node = pluginNode();
    if (!node) return { ok: false, detail: "нет object" };
    var t = "?";
    try {
      t = typeof node.CreateBlob;
    } catch (e) {
      t = "ошибка typeof";
    }
    try {
      var blob = node.CreateBlob(0);
      return {
        ok: blob != null,
        detail: "typeof=" + t + (blob != null ? ", вызов ок" : ", вызов вернул пусто")
      };
    } catch (e2) {
      return { ok: false, detail: "typeof=" + t + ", вызов: " + errText(e2) };
    }
  }

  function pluginAlive() {
    var probe = probeCreateBlob();
    if (probe.ok) return true;
    /* запасной путь: обёртка avcmx сама берёт #oavcmx */
    try {
      if (typeof avcmx === "function") {
        var b = avcmx().blob();
        return !!b;
      }
    } catch (e) {}
    return false;
  }

  function diagnosePlugin() {
    var lines = [];
    lines.push("сборка страницы: " + BUILD);
    var node = pluginNode();
    lines.push("object#oavcmx: " + (node ? "есть" : "нет"));
    if (node) {
      var probe = probeCreateBlob();
      lines.push("CreateBlob: " + (probe.ok ? "да" : "нет") + " (" + probe.detail + ")");
      lines.push("CreateBlob callable: " + (activeXCallable(node, "CreateBlob") ? "да" : "нет"));
      try {
        lines.push("Version: " + (node.Version || "—"));
      } catch (e) {
        lines.push("Version: ошибка");
      }
    }
    lines.push("avcmx(): " + (typeof avcmx === "function" ? "да" : "нет"));
    try {
      if (typeof avcmx === "function") {
        try {
          avcmx().blob();
          lines.push("avcmx().blob(): ок");
        } catch (eBlob) {
          lines.push("avcmx().blob(): " + errText(eBlob));
        }
      }
    } catch (eWrap) {
      lines.push("avcmx probe: " + errText(eWrap));
    }
    try {
      /* Если <object id="oavcmx"> уже работает, второй экземпляр ActiveX не создаём — иначе два экземпляра блокируют AvCryptMail.dll */
      if (node && probeCreateBlob().ok) {
        lines.push("ActiveX: активен через object#oavcmx");
      } else if (typeof window.ActiveXObject !== "undefined") {
        try {
          var ax = new window.ActiveXObject("AVEST.AvCMXWebP");
          lines.push(
            "ActiveX AVEST.AvCMXWebP: " +
              (ax && activeXCallable(ax, "CreateBlob") ? "да" : "создан, CreateBlob сомнителен")
          );
        } catch (e2) {
          lines.push("ActiveX AVEST.AvCMXWebP: нет (" + (e2.message || e2) + ")");
        }
      } else {
        lines.push("ActiveXObject: недоступен (смотрите object/CreateBlob выше)");
      }
    } catch (e3) {
      lines.push("ActiveX проверка: " + (e3.message || e3));
    }
    lines.push("UA: " + (navigator.userAgent || ""));
    setDiag(lines.join("<br/>"));
    return pluginAlive();
  }

  function decodeBufferUtf8(buf) {
    if (!buf) return "";
    try {
      var bytes = new Uint8Array(buf);
      var out = "";
      var i;
      for (i = 0; i < bytes.length; i++) {
        out += "%" + ("0" + bytes[i].toString(16)).slice(-2);
      }
      return decodeURIComponent(out);
    } catch (e) {
      return "";
    }
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
        var raw = "";
        if (binary && xhr.response) {
          raw = decodeBufferUtf8(xhr.response);
        } else {
          raw = xhr.responseText || "";
        }
        var err = JSON.parse(raw || "{}");
        if (err.error && err.error.message) message = err.error.message;
        else if (err.detail) message = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
        else if (err.message) message = err.message;
      } catch (e2) {}
      if (message === "Ошибка HTTP 400") {
        message =
          "Ошибка HTTP 400: ссылка подписи истекла или попала на другой процесс сервера. " +
          "В Chrome нажмите «Подпись в Internet Explorer» ещё раз и откройте новую ссылку.";
      }
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
    var select = document.getElementById("cert-select");
    if (select && select.options && select.options.length > 0 && select.selectedIndex >= 0) {
      var opt = select.options[select.selectedIndex];
      var pub = opt ? (opt.getAttribute("data-pub") || "") : "";
      if (pub) return pub;
    }
    return chosenPubKeyId || "";
  }

  function rememberCert(certs) {
    if (!certs || !certs.length || certs.length() < 1) return "";
    fillCertSelect(certs);
    return selectedPubKeyId();
  }

  var preloadBusy = false;

  /** Синхронное чтение личного справочника (AVCMF_NO_AUTH не показывает окон и не блокирует IE). */
  function readMyCertsSync() {
    var conn = avcmx().connection(noAuthFlags());
    var params = avcmx().params().add(AVCM_TYPE, avcmx().blob().int(AVCM_TYPE_MY));
    var certs = conn.selectCerts(params, allCertFlags());
    return rememberCert(certs);
  }

  /** Предзагрузка личного справочника (AVCMF_NO_AUTH + AVCM_TYPE_MY, как в демо sign_cmx.jsp). */
  function preloadCerts(cb) {
    if (selectedPubKeyId()) {
      if (cb) cb(null);
      return;
    }
    if (preloadBusy) {
      if (cb) cb(null);
      return;
    }
    if (typeof avcmx !== "function" || !pluginAlive()) {
      if (cb) cb(null);
      return;
    }
    try {
      var pubSync = readMyCertsSync();
      if (pubSync) {
        if (cb) cb(null);
        return;
      }
    } catch (eSync) {
      if (isProtectedModeError(eSync)) {
        if (cb) cb(eSync);
        return;
      }
    }
    preloadBusy = true;
    try {
      avcmx().connectionAsync(noAuthFlags(), function (e, conn) {
        preloadBusy = false;
        if (e || !conn) {
          if (cb) cb(e);
          return;
        }
        try {
          var params = avcmx().params().add(AVCM_TYPE, avcmx().blob().int(AVCM_TYPE_MY));
          var certs = conn.selectCerts(params, allCertFlags());
          rememberCert(certs);
        } catch (err) {}
        if (cb) cb(null);
      });
    } catch (ex) {
      preloadBusy = false;
      if (cb) cb(ex);
    }
  }

  /**
   * Выбор сертификата:
   * 1. Сначала сессия AVCMF_NO_AUTH и список личных сертификатов (AVCM_TYPE_MY) — как в демо АВЕСТ sign_cmx.jsp.
   * 2. Если в списке пусто — диалог selectCertsDlgAsync.
   * 3. Запасной путь — авторизация контейнера с диалогом.
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

    setStatus("Чтение сертификата из личного справочника АВЕСТ…");

    try {
      var pubSync = readMyCertsSync();
      if (pubSync) {
        done(null, pubSync);
        return;
      }
    } catch (eSync) {
      if (isProtectedModeError(eSync)) {
        done("Сессия АВЕСТ не открылась: " + errText(eSync));
        return;
      }
    }

    avcmx().connectionAsync(noAuthFlags(), function (e, conn) {
      if (!e && conn) {
        try {
          var params = avcmx().params().add(AVCM_TYPE, avcmx().blob().int(AVCM_TYPE_MY));
          var certs = conn.selectCerts(params, allCertFlags());
          var pub = rememberCert(certs);
          if (pub) {
            done(null, pub);
            return;
          }
        } catch (errList) {}

        try {
          conn.selectCertsDlgAsync(
            "Выбор сертификата ГосСУОК",
            "Выберите личный сертификат. AvPass должен быть вставлен.",
            allCertFlags(),
            function (e2, dlgCerts) {
              if (!e2 && dlgCerts) {
                var pub2 = rememberCert(dlgCerts);
                if (pub2) {
                  done(null, pub2);
                  return;
                }
              }
              tryAuthDialog(done, e2);
            }
          );
          return;
        } catch (errDlg) {
          tryAuthDialog(done, errDlg);
          return;
        }
      }

      tryAuthDialog(done, e);
    });
  }

  function tryAuthDialog(done, prevErr) {
    setStatus("Открываю окно АВЕСТ — выберите сертификат и введите пароль AvPass…");
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
        } catch (eOwn) {}
      }
      done("Сессия АВЕСТ не открылась: " + errText(prevErr || eAuth));
    });
  }

  function openSignConnection(pubKeyId, done) {
    var login = avcmx().params().add(AVCM_PUB_KEY_ID, avcmx().blob().zttext(pubKeyId));
    var flags = softFlags();
    try {
      if (typeof AVCMF_FORCE_TOKEN_CONTROL !== "undefined") flags = flags | AVCMF_FORCE_TOKEN_CONTROL;
    } catch (eFlag) {}
    avcmx().connectionAsync(login, flags, function (e, conn) {
      if (e) {
        avcmx().connectionAsync(login, softFlags(), function (e2, conn2) {
          if (e2) {
            done(errText(e2));
            return;
          }
          done(null, conn2);
        });
        return;
      }
      done(null, conn);
    });
  }

  function fetchPendingPdfs(docs, done) {
    var buffers = [];
    var idx = 0;
    function step() {
      if (idx >= docs.length) {
        done(null, buffers);
        return;
      }
      var doc = docs[idx];
      setWork("Скачиваю PDF (" + (idx + 1) + "/" + docs.length + "): " + (doc.file_name || doc.id) + "…");
      api(
        "GET",
        "/api/v1/ie-sign/" + encodeURIComponent(token) + "/documents/" + doc.id + "/pdf/",
        null,
        true,
        function (buf) {
          buffers.push({ doc: doc, b64: arrayBufferToBase64(buf) });
          idx += 1;
          step();
        },
        function (message) {
          done(message);
        }
      );
    }
    step();
  }

  function signOneWithConn(conn, item, done) {
    setWork("Подписываю " + (item.doc.file_name || item.doc.id) + "…");
    doSign(conn, item.b64, item.doc, done);
  }

  function doSign(conn, b64, doc, done) {
    try {
      var message = conn.message(avcmx().blob().base64(b64));
      var signFlags = AVCMF_DETACHED | AVCMF_ADD_SIGN_CERT;
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
    setStatus("Подготовка: скачивание " + pending.length + " PDF с сервера…");

    fetchPendingPdfs(pending, function (fetchErr, items) {
      if (fetchErr || !items) {
        signingBusy = false;
        setWork("");
        setStatus(fetchErr || "Не удалось скачать PDF для подписи.", "err");
        return;
      }

      setStatus("Шаг 1/" + items.length + ": выбор сертификата AvPass…");
      pickCertificate(function (pickErr, pub) {
        if (pickErr || !pub) {
          signingBusy = false;
          setWork("");
          setStatus(pickErr || "Сертификат не выбран.", "err");
          return;
        }
        setStatus("Авторизация на носителе AvPass (введите пароль в окне АВЕСТ)…", "ok");
        openSignConnection(pub, function (connErr, conn) {
          if (connErr || !conn) {
            signingBusy = false;
            setWork("");
            setStatus(connErr || "Не удалось открыть сессию подписи.", "err");
            return;
          }

          var signatures = [];
          var index = 0;

          function next(err) {
            if (err) {
              signingBusy = false;
              setWork("");
              setStatus(err, "err");
              return;
            }
            if (index >= items.length) {
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
            setStatus("Подпись документа " + (index + 1) + " из " + items.length + "…");
            signOneWithConn(conn, items[index], function (signErr, row) {
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
      });
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
    preloadCerts(function (err) {
      if (err) {
        setStatus("Плагин виден, но сессия не открылась: " + errText(err), "err");
        return;
      }
      var pub = selectedPubKeyId();
      setStatus(
        "Плагин и справочник готовы (сборка " + BUILD + (pub ? ", сертификат найден" : "") + "). Нажмите «Подписать документы AvPass».",
        "ok"
      );
    });
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
    preloadCerts(function (err) {
      if (err) {
        setStatus("Плагин загружен, но сессия АВЕСТ не открылась: " + errText(err), "err");
        return;
      }
      setStatus("Плагин сообщил onload. Можно подписывать (сборка " + BUILD + ").", "ok");
    });
  };

  window.reloadPlugin = safeCall(checkPluginOnly, "Проверка плагина");
  window.signPending = safeCall(signPending, "Подпись");
  window.reloadSession = safeCall(reloadSession, "Обновление");

  window.onload = function () {
    token = qs("t");
    diagnosePlugin();
    preloadCerts();
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
        preloadCerts(function (err) {
          if (err) {
            setStatus("Комплект загружен, но сессия АВЕСТ не открылась: " + errText(err), "err");
            return;
          }
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
        });
      },
      function (message) {
        setStatus(message, "err");
      }
    );
  };
}(window, document));
