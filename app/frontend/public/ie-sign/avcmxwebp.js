/*
 * AVEST CryptMail X Web Plugin Javascript Wrapper 1.1.5
 * 
 * Copyright 2005-2014 AVEST plc.
 * @author Alexey Dymov <smoke@avest.org>
*/
(function (window, undefined) {
    // our AvCMX object instance
    var instance,
        avcmxInstance,
        windowExists = typeof window === "object" && typeof window.document === "object",
        // object names for inheritance (e.g. Message extends avcmxobject)
        objects = ("Blob Parameters Connection Message Certificates AttributeCertificates " +
            "Certificate AttributeCertificate CRL Requests Request Scep Extension Attribute CertificateStatus NameAttribute Sign SignAttribute").split(" "),
        // messages names for inheritance (e.g. RawMessage extends Message)
        messages = "RawMessage SignedMessage EncryptedMessage".split(" ");

    function extend(target, other) {
        target = target || {};
        for (var prop in other) {
            if (typeof other[prop] === 'object') {
                target[prop] = extend(target[prop], other[prop]);
            } else {
                target[prop] = other[prop];
            }
        }
        return target;
    }

    function isFunction(functionToCheck) {
        var getType = {};
        return functionToCheck && getType.toString.call(functionToCheck) === '[object Function]';
    }

    /**
     * @class AvCMXError
     * Создает объект исключения
     * @extends Error
     */

    /**
     * @method constructor
     * @param {Number} nativeCode - оригинальный нативный код ошибки
     */
    function AvCMXError(nativeCode) {
        /**
         * @property {Number}
         * преобразованный (документированный) код ошибки
         */
        this.code = AvCMXError.fromNativeCode(nativeCode);
        /**
         * @property {String}
         * текст ошибки
         */
        this.message = instance.GetErrorInformation(nativeCode, 0);
    }

    /**
     * @method lastError
     * Возвращает преобразованный (документированный) код последней произошедшей ошибки
     * @return {Number}
     * @static
     */
    AvCMXError.lastError = function () {
        if (instance === undefined) {
            return 0;
        }
        var lastError = parseInt(instance.GetLastError());
        return AvCMXError.fromNativeCode(lastError);
    }

    /**
     * @method fromNativeCode
     * Преобразует к документированному виду переданный нативный код ошибки
     * @param {Number} nativeCode - нативный код ошибки
     * @return {Number}
     * @static
     */
    AvCMXError.fromNativeCode = function (nativeCode) {
        if (avcmx.oldActiveX && (((nativeCode >> 16) & 0x1FFF) == 0x014E)) {
            return avcmx.constants.AVCMR_BASE + (nativeCode & 0xFFFF);
        } else {
            return nativeCode;
        }
    }

    /**
     * @method lastErrorIs
     * Проверяет соответствует ли преобразованный (документированный) код последней произошедшей ошибки переданному
     * @param {Number} error - код ошибки для проверки
     * @return {Boolean}
     * @static
     */
    AvCMXError.lastErrorIs = function (error) {
        return error == AvCMXError.lastError();
    }

    AvCMXError.prototype = new Error();

    // all objects inherit this
    /**
     * @class avcmxobject
     * Абстрактный объект-обертка
     * @abstract
     * @typevar T
     */

    /**
     * @method constructor
     * @param {T} obj - нативный объект
     * @private
     */
    function avcmxobject(obj) {
        /**
         * @property {T}
         * нативный объект
         * @protected
         */
        this.object = obj;
    }
    avcmxobject.prototype = extend(avcmxobject.prototype, {
        _name: "",

        object: null,

        init: function () {

        },

        /**
         * Возвращает нативный объект
         * @return {T}
         */
        get: function () {
            return this.object;
        },

        stringify: function () {
            var isRoot = this.constructor == avcmx;
            var name = "AvCMX" + (isRoot ? "" : ("." + this._name));
            return "[wrapper " + (avcmx.oldActiveX ||
                /* Browsers allow custom toString for <object> but IE9+ doesnt */ isRoot ? name: this.object.toString()) + "]";
        },

        // helps not to wrap the same native object twice
        factory: function (obj, helper) {
            return this.object === obj ? this : avcmx(obj, helper);
        },

        makeAsync: function (fn) {
            var self = this;
            return function () {
                var wrappedArgs = [];
                var errorCode = arguments[0];
                if (errorCode) {
                    wrappedArgs.push(new AvCMXError(errorCode));
                } else {
                    wrappedArgs.push(undefined);
                }
                if (arguments.length > 1) {
                    for (var i = 1; i < arguments.length; i++) {
                        wrappedArgs.push(avcmx(arguments[i]));
                    }
                }
                return fn.apply(self, wrappedArgs);
            };
        }
    });
    
    // Browsers can extend toString, but IE < 9 cannot
    avcmxobject.prototype.toString = avcmxobject.prototype.stringify;

    avcmx.prototype = new avcmxobject();
    avcmx.prototype.constructor = avcmx;
    // global factory function
    /*
     * Создает главный объект AvCMX
     * @name avcmx
     * @function
     * @return {avcmx}
     */

    /**
     * @class avcmx
     * Корневой объект
     * @extends avcmxobject.<native.AvCMX>
     * @singleton
     */

    /*
     * Обертка для нативных объектов.
     * @name avcmx
     * @function
     * @param {mixed} obj - нативный объект
     * @param {string} [helper] - помощник (для AvCMCOM)
     * @return {avcmxobject}
     */

    /**
     * @method constructor
     * @private
     */
    function avcmx(obj, helper) {
        if (obj !== undefined) {
            if (avcmx.oldActiveX) {
                if (obj.toString && obj.toString().indexOf("IAvCM") == 0) {
                    return new avcmx[obj.toString().substring(5)](obj);
                } else {
                    var detector = {
                        "Blob": "SetAsBase64",
                        "Parameters": "AddParameterWithSpec",
                        "Connection": "CreateMessage",
                        "SignedMessage": "SignsCount",
                        "EncryptedMessage": "Decrypt",
                        "RawMessage": "AppendContent",
                        "Scep": "TransactionId",
                        "Certificates": "QueryCertificates",
                        "Certificate": "GetSubjectNameAttributeByOid",
                        "AttributeCertificate": "HolderCertificate",
                        "CRL": "GetAttribute",
                        "Requests": "QueryRequests",
                        "Request": "MSCACompatible",
                        "Extension": "Critical",
                        "CertificateStatus": "RevocationTime",
                        "Sign": "GetAuthorizedAttributeByOid"/*,
                        "NameAttribute": "xxx",
                        "Attribute": "xxx",
                        "AttributeCertificates": "+",
                        "SignAttribute": "xxx"*/
                    };
                    for (var type in detector) {
                        if (detector[type] in obj) {
                            return new avcmx[type](obj);
                        }
                    }
                    if (helper !== undefined) {
                        return new avcmx[helper](obj);
                    }
                }
            } else {
                if (obj.toString && obj.toString().indexOf("AvCMX.") == 0) {
                    return new avcmx[obj.toString().substring(6)](obj);
                } else {
                    // XXX: return the original object if we cannot wrap it
                    return obj;
                }
            }
        }
        if (avcmxInstance === undefined) {
            avcmxInstance = new avcmx.prototype.init();
        }
        return avcmxInstance;
    }

    // define construtors
    for (var i = 0; i < objects.length; i++) {
        avcmx[objects[i]] = function (obj) {
            avcmxobject.call(this, obj);
        }
        avcmx[objects[i]].prototype = new avcmxobject();
        avcmx[objects[i]].prototype.constructor = avcmx[objects[i]];
        avcmx[objects[i]].prototype._name = objects[i];
    }
    for (var i = 0; i < messages.length; i++) {
        avcmx[messages[i]] = function (obj) {
            avcmx.Message.call(this, obj);
        }
        avcmx[messages[i]].prototype = new avcmx.Message();
        avcmx[messages[i]].prototype.constructor = avcmx[messages[i]];
        avcmx[messages[i]].prototype._name = messages[i];
    }

    avcmx.prototype = extend(avcmx.prototype, {
        init: function () {
            if (!instance) {
                if (windowExists) {
                    instance = document.getElementById("oavcmx");
                }
                if (!instance) {
                    if (avcmx.oldActiveX) {
                        instance = new ActiveXObject("AvCryptMailCOMSystem.AvCryptMailSystem");
                    } else {
                        try {
                            instance = new ActiveXObject("AVEST.AvCMXWebP");
                        } catch (e) {
                            if (e.name == "Error" || e.name == "TypeError") {
                                try {
                                    instance = new ActiveXObject("AvCryptMailCOMSystem.AvCryptMailSystem");
                                    avcmx.oldActiveX = true;
                                } catch (e) { }
                            }
                        }
                    }
                }
            }
            if (!instance) {
                throw new Error('AvCMX document object element not found. Did you forget to add <object id="oavcmx" type="application/x-avcmx-web-plugin" width="0" height="0"></object> to your page?');
            }
            this.object = instance;
            return this;
        },

        /**
         * Возвращает текущую версию компонента.
         *
         * Пример:
         *
         *     avcmx().version()
         *
         * @return {String}
         */
        version: function () {
            return instance.Version;
        },

        /**
         * Создает объект данных.
         *
         * Пример:
         *
         *     avcmx().blob();
         *
         * @param {Number} [flags=0] Флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Blob}
         */
        blob: function (flags) {
            flags = flags || 0;
            return this.factory(instance.CreateBlob(flags));
        },

        /**
         * Создает объект параметров.
         *
         * Пример:
         *
         *     avcmx().params();
         *
         * @param {Number} [flags=0] Флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Parameters}
         */
        params: function (flags) {
            flags = flags || 0;
            return this.factory(instance.CreateParameters(flags));
        },

        /**
         * Создает контекст авторизации пользователя.
         *
         * <b>Примечание: данный метод может отображать диалоги, что "подвесит" окно браузера и 
         * оно будет недоступно. Рекомендуется использовать асинхронный аналог {@link avcmx#connectionAsync}</b>
         *
         * Авторизация с выводом диалога выбора сертификата:
         *
         *     avcmx().connection();
         *
         * Создание соединения без авторизации:
         *
         *     avcmx().connection(AVCMF_NO_AUTH);
         *
         * Авторизация с передачей параметра пароля к контейнеру:
         *
         *     avcmx().connection(avcmx().params().add(AVCM_PASSWORD, "12345678"));
         *
         * На данный момент поддерживаются следующие параметры:
         *
         * - <b>AVCM_DB_CONNECTSTR</b> – строка ADO ConnectString для соединения с базой.
         * - <b>AVCM_PUB_KEY_ID</b> – идентификатор открытого ключа сертификата 
         * пользователя, чьим личным ключом будет произведена авторизация. Если этот 
         * параметр не указан, то система выдаст окно со списком сертификатов пользователя 
         * для выбора того сертификата, при помощи которого будет произведена 
         * авторизация.
         * - <b>AVCM_COMMON_NAME</b> – атрибут CommonName субъекта сертификата 
         * пользователя, чьим личным ключом будет произведена авторизация. Если этот 
         * параметр не указан, то система выдаст окно со списком сертификатов пользователя 
         * для выбора того сертификата, при помощи которого будет произведена 
         * авторизация.
         * - <b>AVCM_PASSWORD</b> – пароль доступа к контейнеру личных ключей. Если в
         * персональном справочнике только один сертификат, то система произведет
         * попытку авторизации с этим сертфикатом, не отображая окно выбора личного
         * сертификата.
         * - <b>AVCM_MSG_INI</b> – содержимое конфигурационного файла AvCmMsg.ini. Данный
         * параметр предназначен для уточнения некоторых опций конфигурации, например,
         * тип криптопровайдера или аглоритмы ЭЦП.
         * 
         * На данный помент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_NO_AUTH</b> – подключение без аутентификации пользователя.
         * Использование сессии без открытия контейнера личных ключей и поиска личного
         * сертификата. Использование такой сессии для операций, требующих наличия
         * личного сертификата и контейнера личных ключей, невозможно
         * - <b>AVCMF_FORCE_TOKEN_CONTROL</b> – контроль наличия вставленного
         * носителя с личным ключом
         * - <b>AVCMF_DENY_TOKEN_CONTROL</b> – запрет контроля наличия вставленного
         * носителя с личным ключом
         * - <b>AVCMF_IGNORE_CRL_ABSENCE</b> – игнорировать отсутствие СОС.
         * 
         * Возможные значения ошибок:
         * 
         * - <b>AVCMR_SUCCESS</b> – успешное подключение пользователя
         * - <b>AVCMR_CONTAINER_NOT_FOUND</b> – не найден контейнер с личными ключами на носителе
         * - <b>AVCMR_DEVICE_NOT_FOUND</b> – не найден носитель
         * - <b>AVCMR_BAD_PASSWORD</b> – пароль неверен
         * - <b>AVCMR_NO_DB_PARAMS</b> – не указаны параметры подключения к базе данных
         * - <b>AVCMR_DB_NOT_FOUND</b> – невозможно подключится к базе данных
         * - <b>AVCMR_CERT_STORE_NOT_FOUND</b> – не найдено или пусто хранилище сертификатов
         * - <b>AVCMR_CERT_NOT_FOUND</b> – не найден личный сертификат
         * - <b>AVCMR_BAD_FLAGS</b> – функции переданы неверные флаги
         * - <b>AVCMR_BAD_PARAM</b> – параметр функции неверен
         * - <b>AVCMR_TOKEN_NOT_FOUND</b> – носитель с личным ключом не установлен
         *
         * @param {avcmx.Parameters} [params] параметры идентификации пользователя и параметры подключения.
         * @param {Number} [flags=0] флаги, режимы подключения.
         * @return {avcmx.Connection}
         * @deprecated 1.1.1 Заменен на {@link avcmx#connectionAsync}
         */
        connection: function (params, flags) {
            if (flags === undefined) flags = (typeof params === "number" ? params : 0);
            params = (!params || (params === flags)) ? instance.CreateParameters(0) : params.get();
            return this.factory(instance.CreateConnection(params, flags));
        },

        /**
         * Создает контекст авторизации пользователя.
         *
         * Авторизация с выводом диалога выбора сертификата:
         *
         *     avcmx().connectionAsync(function (e, conn) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем conn
         *     );
         *
         * Создание соединения без авторизации:
         *
         *     avcmx().connectionAsync(AVCMF_NO_AUTH, function (e, conn) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем conn
         *     );
         *
         * Авторизация с передачей параметра пароля к контейнеру:
         *
         *     avcmx().connectionAsync(avcmx().params().add(AVCM_PASSWORD, "12345678"), function (e, conn) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем conn
         *     );
         *
         * На данный момент поддерживаются следующие параметры:
         *
         * - <b>AVCM_DB_CONNECTSTR</b> – строка ADO ConnectString для соединения с базой.
         * - <b>AVCM_PUB_KEY_ID</b> – идентификатор открытого ключа сертификата 
         * пользователя, чьим личным ключом будет произведена авторизация. Если этот 
         * параметр не указан, то система выдаст окно со списком сертификатов пользователя 
         * для выбора того сертификата, при помощи которого будет произведена 
         * авторизация.
         * - <b>AVCM_COMMON_NAME</b> – атрибут CommonName субъекта сертификата 
         * пользователя, чьим личным ключом будет произведена авторизация. Если этот 
         * параметр не указан, то система выдаст окно со списком сертификатов пользователя 
         * для выбора того сертификата, при помощи которого будет произведена 
         * авторизация.
         * - <b>AVCM_PASSWORD</b> – пароль доступа к контейнеру личных ключей. Если в
         * персональном справочнике только один сертификат, то система произведет
         * попытку авторизации с этим сертфикатом, не отображая окно выбора личного
         * сертификата.
         * - <b>AVCM_MSG_INI</b> – содержимое конфигурационного файла AvCmMsg.ini. Данный
         * параметр предназначен для уточнения некоторых опций конфигурации, например,
         * тип криптопровайдера или аглоритмы ЭЦП.
         * 
         * На данный помент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_NO_AUTH</b> – подключение без аутентификации пользователя.
         * Использование сессии без открытия контейнера личных ключей и поиска личного
         * сертификата. Использование такой сессии для операций, требующих наличия
         * личного сертификата и контейнера личных ключей, невозможно
         * - <b>AVCMF_FORCE_TOKEN_CONTROL</b> – контроль наличия вставленного
         * носителя с личным ключом
         * - <b>AVCMF_DENY_TOKEN_CONTROL</b> – запрет контроля наличия вставленного
         * носителя с личным ключом
         * - <b>AVCMF_IGNORE_CRL_ABSENCE</b> – игнорировать отсутствие СОС.
         * 
         * Возможные значения ошибок:
         * 
         * - <b>AVCMR_SUCCESS</b> – успешное подключение пользователя
         * - <b>AVCMR_CONTAINER_NOT_FOUND</b> – не найден контейнер с личными ключами на носителе
         * - <b>AVCMR_DEVICE_NOT_FOUND</b> – не найден носитель
         * - <b>AVCMR_BAD_PASSWORD</b> – пароль неверен
         * - <b>AVCMR_NO_DB_PARAMS</b> – не указаны параметры подключения к базе данных
         * - <b>AVCMR_DB_NOT_FOUND</b> – невозможно подключится к базе данных
         * - <b>AVCMR_CERT_STORE_NOT_FOUND</b> – не найдено или пусто хранилище сертификатов
         * - <b>AVCMR_CERT_NOT_FOUND</b> – не найден личный сертификат
         * - <b>AVCMR_BAD_FLAGS</b> – функции переданы неверные флаги
         * - <b>AVCMR_BAD_PARAM</b> – параметр функции неверен
         * - <b>AVCMR_TOKEN_NOT_FOUND</b> – носитель с личным ключом не установлен
         *
         * @param {avcmx.Parameters} [params] параметры идентификации пользователя и параметры подключения.
         * @param {Number} [flags=0] флаги, режимы подключения.
         * @param {Function} fn функция для обработки созданного соединения или ошибки создания.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @param {avcmx.Connection} fn.conn объект соединения, либо undefined в случае ошибки.
         * @chainable
         * @since 1.1.1
         */
        connectionAsync: function (params, flags, fn) {
            if (isFunction(fn)) params = params.get();
            else {
                if (isFunction(flags)) {
                    fn = flags;
                    flags = (typeof params === "number" ? params : 0);
                    params = (!params || (params === flags)) ? instance.CreateParameters(0) : params.get();
                } else {
                    fn = params;
                    flags = 0;
                    params = instance.CreateParameters(0);
                }
            }
            this.object.CreateConnectionAsync(params, flags, this.makeAsync(fn));
            return this;
        },

        /**
         * Хеширование данных с использованием заданного алгоритма.
         * 
         * Если указанный алгоритм недоступен в системе (не установлен криптопровайдер поддерживающий данный алгоритм)
         * будет возвращена ошибка "Указан неправильный алгоритм."
         * 
         * Хеширование данных используя алгоритм СТБ 34.101.31
         * 
         *     avcmx().hash(avcmx().blob().text("abcd"), "1.3.6.1.4.1.12656.1.42").hex()
         *     avcmx().hash(avcmx().blob().text("abcd"), "1.2.112.0.2.0.34.101.31.81").hex()
         *     
         * Хеширование данных используя алгоритм SHA-1
         * 
         *     avcmx().hash(avcmx().blob().text("abcd"), "1.3.14.3.2.26").hex()
         *     
         * На данный момент поиск алгоритма хеширования производится среди следующих типов криптопровайдеров:
         * 
         * - Avest CSP (типы 421, 420)
         * - Avest CSP Bel (типы 423, 422)
         * - Avest CSP Bign (тип 424)
         * - КриптоПро (типы 71, 75)
         * - Microsoft Base Cryptographic Provider v1.0 (тип 1)
         * 
         * @param {avcmx.Blob} blob блоб с данными для хеширования.
         * @param {String} oid идентификатор объекта алгоритма хеширования.
         * @param {Number} [flags=0] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Blob}
         */
        hash: function (blob, oid, flags) {
            flags = flags || 0;
            return this.factory(instance.Hash(blob.get(), oid, flags));
        }
    });

    avcmx.prototype.init.prototype = avcmx.prototype;

    /**
     * @class avcmx.Blob
     * Предназначен для работы с данными. Используется для обмена любыми данными с методами других объектов. 
     * У объекта есть внутреннее свойство "содержимое", которое используется при передаче объекта как 
     * входного параметра в методы объектов системы, и которое заполняется методами 
     * системы при получении объекта как выходного параметра.
     * @extends avcmxobject.<native.AvCMX.Blob>
     */
    avcmx.Blob.prototype = extend(avcmx.Blob.prototype, {
        /**
         * Установка и получение данных блоба в шестнадцатиричном виде.
         * 
         * Установка в блоб в шестнадцатиричном виде и получение в виде текста
         * 
         *      text = avcmx().blob().hex("313233").text(); // text == "123"
         *     
         * Установка в блоб в виде текста и получение в шестнадцатиричном виде
         * 
         *      hex = avcmx().blob().text("123").hex(); // hex == "313233"
         * 
         * @param {String} [val] данные для установки
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Blob|String} при установке данных возвращается объект блоба, при получении - строка
         */
        hex: function (val, flags) {
            if (flags === undefined) flags = (typeof val === "number" ? val : 0);
            if (!val || (val === flags)) {
                return this.object.GetAsHex(flags);
            } else {
                this.object.SetAsHex(val, flags);
                return this;
            }
        },

        /**
         * Установка и получение данных блоба в текстовом виде.
         * По умолчанию строки в блобе хранятся в виде ASCII. С помощью флагов данной функции можно задать 
         * в каком виде представлена строка в блобе.
         * 
         * Установка данных в блоб в шестнадцатиричном виде и получение в виде текста
         * 
         *      text = avcmx().blob().hex("313233").text(); // text == "123"
         *     
         * Установка данных в блоб в виде текста и получение в шестнадцатиричном виде
         * 
         *      hex = avcmx().blob().text("123").hex(); // hex == "313233"
         *     
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMXF_ZT_STRING</b> – к строке будет добавлен нулевой байт. Аналогично вызову {@link avcmx.Blob#zttext}. 
         * Данный флаг необходимо использовать при устрановке строковых значений для некоторых параметров авторизации.
         * Данный флаг можно комбинировать с другими.
         * - <b>AVCMXF_UCS2_STRING</b> – указывает, что строка закодирована в UCS2. Аналогично вызову {@link avcmx.Blob#ucs2text}.
         * - <b>AVCMXF_UTF8_STRING</b> – указывает, что строка закодирована в UTF-8. Аналогично вызову {@link avcmx.Blob#utf8text}.
         * 
         * Установка данных в блоб в виде текста и получение в шестнадцатиричном виде
         * 
         *      hex = avcmx().blob().text("абв").hex(); // hex == "E0E1E2"
         *     
         * Установка данных в блоб в виде текста (с нулевым байтом) и получение в шестнадцатиричном виде
         * 
         *      hex = avcmx().blob().text("абв", AVCMXF_ZT_STRING).hex(); // hex == "E0E1E200"
         *     
         * Установка данных в блоб в виде текста (для представленния в UCS2) и получение в шестнадцатиричном виде
         * 
         *      hex = avcmx().blob().text("абв", AVCMXF_UCS2_STRING).hex(); // hex == "300431043204"
         *     
         * Установка данных в блоб в виде текста (для представленния в UCS2  нулевыми байтами) и получение в шестнадцатиричном виде
         * 
         *      hex = avcmx().blob().text("абв", AVCMXF_UCS2_STRING | AVCMXF_ZT_STRING).hex(); // hex == "3004310432040000"
         *     
         * Установка данных в блоб в виде текста (для представленния в UTF-8) и получение в шестнадцатиричном виде
         * 
         *      hex = avcmx().blob().text("абв", AVCMXF_UTF8_STRING).hex(); // hex == "D0B0D0B1D0B2"
         * 
         * @param {String} [val] данные для установки.
         * @param {Number} [flags] флаги.
         * @return {avcmx.Blob|String} при установке данных возвращается объект блоба, при получении - строка
         */
        text: function (val, flags) {
            if (flags === undefined) flags = (typeof val === "number" ? val : 0);
            if (!val || (val === flags)) {
                return this.object.GetAsText(flags);
            } else {
                this.object.SetAsText(val, flags);
                return this;
            }
        },

        /**
         * Установка и получение данных блоба в текстовом виде (с нулевым байтом).
         * Вызов данного метода аналогичен вызову {@link avcmx.Blob#text} с флагом AVCMXF_ZT_STRING
         *     
         * Установка данных в блоб в виде текста (с нулевым байтом) и получение в шестнадцатиричном виде
         * 
         *      hex = avcmx().blob().zttext("абв").hex(); // hex == "E0E1E200"
         *     
         * @param {String} [val] данные для установки.
         * @param {Number} [flags] флаги. См. {@link avcmx.Blob#text}
         * @return {avcmx.Blob|String} при установке данных возвращается объект блоба, при получении - строка
         */
        zttext: function (val, flags) {
            if (flags === undefined) flags = (typeof val === "number" ? val : 0);
            if (!val || (val === flags)) {
                return this.object.GetAsText(flags | avcmx.constants.AVCMXF_ZT_STRING);
            } else {
                this.object.SetAsText(val, flags | avcmx.constants.AVCMXF_ZT_STRING);
                return this;
            }
        },

        /**
         * Установка и получение данных блоба в текстовом виде (для представления в UCS2).
         * Вызов данного метода аналогичен вызову {@link avcmx.Blob#text} с флагом AVCMXF_UCS2_STRING
         *     
         * Установка данных в блоб в виде текста (для представленния в UCS2) и получение в шестнадцатиричном виде
         * 
         *      hex = avcmx().blob().ucs2text("абв").hex(); // hex == "300431043204"
         * 
         * @param {String} [val] данные для установки.
         * @param {Number} [flags] флаги. См. {@link avcmx.Blob#text}
         * @return {avcmx.Blob|String} при установке данных возвращается объект блоба, при получении - строка
         */
        ucs2text: function (val, flags) {
            if (flags === undefined) flags = (typeof val === "number" ? val : 0);
            if (!val || (val === flags)) {
                return this.object.GetAsText(flags | avcmx.constants.AVCMXF_UCS2_STRING);
            } else {
                this.object.SetAsText(val, flags | avcmx.constants.AVCMXF_UCS2_STRING);
                return this;
            }
        },

        /**
         * Установка и получение данных блоба в текстовом виде для представления в UTF-8.
         * Вызов данного метода аналогичен вызову {@link avcmx.Blob#text} с флагом AVCMXF_UTF8_STRING
         * 
         * Установка данных в блоб в виде текста (для представленния в UTF-8) и получение в шестнадцатиричном виде
         * 
         *      hex = avcmx().blob().uts8text("абв").hex(); // hex == "D0B0D0B1D0B2"
         * 
         * @param {String} [val] данные для установки.
         * @param {Number} [flags] флаги. См. {@link avcmx.Blob#text}
         * @return {avcmx.Blob|String} при установке данных возвращается объект блоба, при получении - строка
         */
        utf8text: function (val, flags) {
            if (flags === undefined) flags = (typeof val === "number" ? val : 0);
            if (!val || (val === flags)) {
                return this.object.GetAsText(flags | avcmx.constants.AVCMXF_UTF8_STRING);
            } else {
                this.object.SetAsText(val, flags | avcmx.constants.AVCMXF_UTF8_STRING);
                return this;
            }
        },

        /**
         * Установка и получение данных блоба в виде целого числа.
         * 
         * Установка числа в блоб и получение в виде числа
         * 
         *     avcmx().blob().int(123).int()
         *     
         * Не нужно путать преобразование строк к числу и установку в виде числа. 
         * Если в блобе хранится строка, то при получении в виде числа (или наоборот) произойдет ошибка
         * 
         *     avcmx().blob().text("123").int() // AvCMXError: Плохие данные.
         * 
         * @param {Number} [val] данные для установки.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Blob|Number} при установке данных возвращается объект блоба, при получении - число
         */
        int: function (val, flags) {
            flags = flags || 0;
            if (typeof val === "number") {
                this.object.SetAsInteger(val, flags);
                return this;
            } else {
                return parseInt(this.object.GetAsInteger(flags));
            }
        },

        /**
         * Установка и получение данных блоба в закодированном в Base64 виде.
         * 
         * Установка данных в блоб в виде текста и получение в Base64
         * 
         *      b64 = avcmx().blob().text("123").base64(); // b64 == "MTIz"
         *     
         * @param {String} [val] данные для установки
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Blob|String} при установке данных возвращается объект блоба, при получении - строка
         */
        base64: function (val, flags) {
            if (flags === undefined) flags = (typeof val === "number" ? val : 0);
            if (!val || (val === flags)) {
                return this.object.GetAsBase64(flags);
            } else {
                this.object.SetAsBase64(val, flags);
                return this;
            }
        },

        /**
         * Установка и получение данных блоба в виде даты и времени.
         * 
         * Установка текущей даты в блоб и получение в виде даты и времени
         * 
         *     avcmx().blob().datetime(new Date()).datetime()
         *     
         * @param {Date} [val] данные для установки.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Blob|Date} при установке данных возвращается объект блоба, при получении - дата и время
         */
        datetime: function (val, flags) {
            if (flags === undefined) flags = (typeof val === "number" ? val : 0);
            if (!val || (val === flags)) {
                return new Date(this.object.GetAsDateTimeSec(flags) * 1000);
            } else {
                this.object.SetAsDateTimeSec(val / 1000, flags);
                return this;
            }
        },

        /**
         * Получение размера данных блоба.
         * @return {Number}
         */
        length: function () {
            return parseInt(this.object.Length);
        }
    });

    /**
     * @class avcmx.Parameters
     * Предназначен для работы с параметрами и опциями.
     * @extends avcmxobject.<native.AvCMX.Parameters>
     */
    avcmx.Parameters.prototype = extend(avcmx.Parameters.prototype, {
        /**
         * Добавление параметра.
         * Некоторые методы для работы с параметрами требуют наличия спецификатора.
         * 
         * Создание списка с двумя параметрами
         * 
         *     avcmx().params()
         *       .add(3, avcmx().blob().text("123"))
         *       .add(10, avcmx().blob().text("abc"))
         *       
         * Создание списка с одним параметром и спецификатором
         * 
         *     avcmx().params().add(1, avcmx().blob().text("123"), avcmx().blob().text("123"))
         * 
         * @param {Number} id идентификатор параметра
         * @param {avcmx.Blob} blob значение параметра
         * @param {avcmx.Blob} [spec] спецификатор
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @chainable
         */
        add: function (id, blob, spec, flags) {
            if (flags === undefined) flags = (typeof spec === "number" ? spec : 0);
            if (!spec || (spec === flags)) {
                this.object.AddParameter(id, blob.get(), flags);
                return this;
            } else {
                this.object.AddParameterWithSpec(id, blob.get(), spec.get(), flags);
                return this;
            }
        },
 
        /**
         * Возвращает количество параметров
         * @return {Number}
         */
        length: function () {
            return parseInt(this.object.Count);
        }
    });

    /**
     * @class avcmx.Connection
     * Сессия для работы со справочником сертификатов и сообщениями
     * @extends avcmxobject.<native.AvCMX.Connection>
     */
    avcmx.Connection.prototype = extend(avcmx.Connection.prototype, {
        /**
         * Предназначен для создания (открытия) сообщения для дальнейшей обработки.
         * 
         * В зависимости формата от переданных данных в результате будет создан объект одного из типов:
         * 
         * - "сырое" сообщение (Raw) {@link avcmx.RawMessage}
         * - подписанное сообщение (Signed) {@link avcmx.SignedMessage}
         * - зашифрованное сообщение (Encrypted) {@link avcmx.EncryptedMessage}
         * 
         * В случае открытия "сырого" (Raw, не PKCS#7) сообщения возможна передача лишь
         * части данных, либо вообще пустого (без данных) объекта {@link avcmx.Blob}. В последнем
         * случае гарантированно будет создан объект "сырого" сообщения типа {@link avcmx.RawMessage}. 
         * Для дальнейшей установки содержимого можно воспользоваться методом {@link avcmx.RawMessage#content}.
         * Например:
         * 
         *     conn = ... // create connection
         *     msg = conn.message(); // msg instanceof avcmx.RawMessage == true
         *     
         * Создание простого сообщения
         * 
         *     conn = ... // create connection
         *     conn.message(avcmx().blob().text("123"));
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_OPEN_FOR_SIGN</b> – данный флаг необходимо использовать для возможности поблочного добавления данных к 
         * содержимому сообщения в режиме подписания с помощью функций {@link avcmx.Message#update} и {@link avcmx.Message#final}. 
         * Флаг должен быть использован совместно с флагом <b>AVCMF_DETACHED</b>.
         * - <b>AVCMF_OPEN_FOR_VERIFYSIGN</b> – данный флаг необходимо использовать для возможности поблочного добавления данных к
         * содержимому сообщения в режиме проверки подписи с помощью функций {@link avcmx.Message#update}, {@link avcmx.Message#final} и {@link avcmx.SignedMessage#verify}. 
         * Флаг должен быть использован совместно с флагом <b>AVCMF_DETACHED</b>.
         * 
         * @param {avcmx.Blob} [blob] данные сообщения
         * @param {Number} [flags] флаги.
         * @return {avcmx.Message}
         */
        message: function (blob, flags) {
            if (flags === undefined) flags = (typeof blob === "number" ? blob : 0);
            blob = (!blob || (blob === flags)) ? instance.CreateBlob(0) : blob.get();
            return this.factory(this.object.CreateMessage(blob, flags));
        },

        /**
         * Создание (разбор) сертификата из блоба.
         * 
         * При использовании без параметров возвращает объект текущего сертификата сессии (аналогично вызову {@link avcmx.Connection#ownCert}).
         * 
         * Разбор сертификата загруженного из файла c:\1.cer
         * 
         *     conn = ... // create connection
         *     blob = ... // get certificate contents
         *     conn.cert(blob);
         * 
         * Получение текущего сертификата сессии
         * 
         *     conn = ... // create connection
         *     conn.cert();
         * 
         * @param {avcmx.Blob} [blob] данные cертификата
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Certificate}
         */
        cert: function (blob, flags) {
            if (flags === undefined) flags = (typeof blob === "number" ? blob : 0);
            blob = (!blob || (blob === flags)) ? null : blob.get();
            if (blob) {
                return this.factory(this.object.CreateCertificate(blob, flags));
            } else {
                return this.ownCert();
            }
        },

        /**
         * Создание (разбор) списка отозванных сертификатов из блоба.
         * 
         * Разбор списка отозванных сертификатов загруженного из файла c:\1.crl
         * 
         *     conn = ... // create connection
         *     blob = ... // get crl contents
         *     conn.crl(blob);
         * 
         * @param {avcmx.Blob} blob данные списка отозванных сертификатов
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.CRL}
         */
        crl: function (blob, flags) {
            flags = flags || 0;
            return this.factory(this.object.CreateCRL(blob.get(), flags));
        },

        /**
         * Создание контекста подключения к серверу по протоколу SCEP (Simple Certificate Enrollment Protocol) 
         * для дальнейшей отправки запросов на сертификаты.
         * 
         * <b>Примечание: данный метод при вызове отправляет запрос на сервер и ожидает ответа, что "подвесит" окно браузера и 
         * оно будет недоступно. Рекомендуется использовать асинхронный аналог {@link avcmx.Connection#scepAsync}</b>
         * 
         * Создание контекста подключения к серверу
         * 
         *     conn = ... // create connection
         *     conn.scep("http://localhost:8080/AvScep/avpkiclient")
         * 
         * Создание контекста подключения к серверу в оффлайн режиме
         * 
         *     conn = ... // create connection
         *     conn.scep("http://localhost:8080/AvScep/avpkiclient", AVCMF_SCEP_OFFLINE)
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_SCEP_OFFLINE</b> – работа по отправке запросов непосредственно на сервер SCEP ложится на приложение
         * 
         * @param {String} url адрес SCEP сервера
         * @param {Number} [flags] флаги.
         * @return {avcmx.Scep}
         * @deprecated 1.1.1 Заменен на {@link avcmx.Connection#scepAsync}
         */
        scep: function (url, flags) {
            flags = flags || 0;
            return this.factory(this.object.CreateScep(url, flags));
        },

        /**
         * Создание контекста подключения к серверу по протоколу SCEP (Simple Certificate Enrollment Protocol) 
         * для дальнейшей отправки запросов на сертификаты.
         * 
         * Создание контекста подключения к серверу
         * 
         *     conn = ... // create connection
         *     conn.scepAsync("http://localhost:8080/AvScep/avpkiclient", function (e, scep) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем scep
         *     })
         * 
         * Создание контекста подключения к серверу в оффлайн режиме
         * 
         *     conn = ... // create connection
         *     conn.scepAsync("http://localhost:8080/AvScep/avpkiclient", AVCMF_SCEP_OFFLINE, function (e, scep) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем scep
         *     });
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_SCEP_OFFLINE</b> – работа по отправке запросов непосредственно на сервер SCEP ложится на приложение
         * 
         * @param {String} url адрес SCEP сервера
         * @param {Number} [flags] флаги.
         * @param {Function} fn функция для обработки созданного контекста или ошибки создания.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @param {avcmx.Scep} fn.scep объект соединения, либо undefined в случае ошибки.
         * @chainable
         * @since 1.1.1
         */
        scepAsync: function (url, flags, fn) {
            if (isFunction(flags)) {
                fn = flags;
                flags = 0;
            }
            this.object.CreateScepAsync(url, flags, this.makeAsync(fn));
            return this;
        },

        /**
         * Возвращает текущий сертификат сессии либо ошибку если авторизация произведена с флагом <b>AVCMF_NO_AUTH</b>
         * @return {avcmx.Certificate}
         * @since 1.1.1
         */
        ownCert: function () {
            return this.factory(this.object.OwnCertificate);
        },

        flush: function (flags) {
            flags = flags || 0;
            this.object.Flush(flags);
            return this;
        },

        /**
         * Предназначен для создания объекта сертификатов путем перебора и отбора сертификатов в справочнике, 
         * удовлетворяющих определенным условиям. Условия для поиска передаются через объект параметров.
         * При этом следует отметить, что по умолчанию перебор осуществляется только среди корректных сертификатов, 
         * то есть для каждого найденного сертификата прозводится полная проверка его корректности. 
         * При необходимости можно получить и сертификаты без проверки корректности, для этого нужно указать флаг <b>AVCMF_ALL_CERT</b>.
         * 
         * Поиск сертификатов, у которых дата издания входит в промежуток от -10 до +10 секунд от текущей
         * 
         *     conn = ... // create connection
         *     currentDate = new Date();
         *     conn.selectCerts(avcmx().params()
         *         .add(AVCM_NOT_BEFORE, avcmx().blob().datetime(new Date(currentDate.getTime() - 10 * 1000)), avcmx().blob().int(AVCM_D_GREATER))
         *         .add(AVCM_NOT_BEFORE, avcmx().blob().datetime(new Date(currentDate.getTime() + 10 * 1000)), avcmx().blob().int(AVCM_D_LESS)), AVCMF_ALL_CERT)
         * 
         * Поиск сертификата по идентификатору открытого ключа
         * 
         *     conn = ... // create connection
         *     pubKeyId = "00112233445566778899AABBCCDDEEFF00112233";
         *     conn.selectCerts(avcmx().params().add(AVCM_PUB_KEY_ID, avcmx().blob().zttext(pubKeyId)), AVCMF_ALL_CERT);
         *     
         * Поиск сертификатов по полной строке имени издателя
         * 
         *     conn = ... // create connection
         *     issuerName = "CN=ПУЦ, OU=ПУЦ, O=ПУЦ, STREET=ПУЦ, L=ПУЦ, ST=ПУЦ, C=BY";
         *     conn.selectCerts(avcmx().params().add(AVCM_ISSUER_AS_STRING, avcmx().blob().zttext(issuerName)), AVCMF_ALL_CERT);
         * 
         * На данный момент поддерживаются следующие критерии поиска:
         * 
         * - <b>AVCM_PURPOSE</b> – указывает предназначение искомых сертификатов.
         * Значение указываемое <b>Value</b> типа Number:
         *     - <b>AVCM_P_SIGN</b> – поиск сертификатов, предназначенных для подписи.
         *     - <b>AVCM_P_CRYPT</b> – поиск сертификатов, предназначенных для зашифрования.
         * - <b>AVCM_EXT_KEY_USAGE_OID</b> – отбор сертификатов по наличию в его списке
         * ограничений применения ключа сертификата заданного идентификатора объекта
         * (OID) в виде строки ASCIIZ.
         * Значение <b>Value</b>: строка значения требуемого ограничения применения ключа сертификата
         * - <b>AVCM_TYPE</b> – указывает тип искомого сертификата
         * Значение указываемое <b>Value</b> типа Number:
         *     - <b>AVCM_TYPE_MY</b> – перебор только личных сертификатов, то есть
         *     сертификатов личные ключи которых имеет текущий аутентифицированный пользователь.
         *     - <b>AVCM_TYPE_ROOT</b> – перебор только сертификатов доверенных центров сертификации.
         * - <b>AVCM_SERIAL_AS_STRING</b> – поиск по серийному номеру сертификата.
         * Значение <b>Value</b>: серийный номер сертификата вида ASCIIZ
         * - <b>AVCM_ISSUER_AS_STRING</b> – поиск по полному имени (X.509 Name) издателя сертификата в виде строки.
         * Значение <b>Value</b>: строка имени издателя
         * - <b>AVCM_ISSUER_ATTR</b> – поиск по атрибуту имени (X.509 Name) издателя
         * сертификата в виде строки. При этом необходима передача идентификатора искомого объекта (поле <b>Spec</b>).
         * Значение <b>Spec</b>: строка идентификатора искомого объекта (OID).
         * Значение <b>Value</b>: строка атрибута имени издателя.
         * - <b>AVCM_NOT_BEFORE</b> – поиск по дате/времени начала действия сертификата.
         * Значение <b>Spec</b> указывает на условие (Number), применяемое при поиске.
         * Возможные значения:
         *     - <b>AVCM_D_GREATER</b> – дата и время начала действия искомого
         *     сертификата должна быть больше или равна указанной дате и времени.
         *     - <b>AVCM_D_LESS</b> – дата и время начала действия искомого сертификата
         *     должна быть меньше или равна указанной дате и времени.
         * Значение <b>Value</b>: дата и время. При этом дата и время дожны быть указаны для текущего часового пояса.
         * - <b>AVCM_NOT_AFTER</b> – поиск по дате/времении окончания действия сертификата.
         * Значение <b>Spec</b> указывает на условие (Number), применяемое при поиске.
         * Возможные значения:
         *     - <b>AVCM_D_GREATER</b> – дата и время окончания действия искомого
         *     сертификата должна быть больше или равна указанной дате и времени.
         *     - <b>AVCM_D_LESS</b> – дата и время окончания окончания искомого
         *     сертификата должна быть меньше или равна указанной дате и времени.
         * Значение <b>Value</b>: дата и время. При этом дата и время дожны быть указаны для текущего часового пояса.
         * - <b>AVCM_KEY_NOT_BEFORE</b> – поиск по дате/времени начала действия личного ключа.
         * Значение <b>Spec</b> указывает на условие (Number), применяемое при поиске.
         * Возможные значения:
         *     - <b>AVCM_D_GREATER</b> – дата и время начала действия искомого личного
         *     ключа должна быть больше или равна указанной дате и времени.
         *     - <b>AVCM_D_LESS</b> – дата и время начала действия искомого личного ключа
         *     должна быть меньше или равна указанной дате и времени.
         * Значение <b>Value</b>: дата и время. При этом дата и время дожны быть указаны для текущего часового пояса.
         * - <b>AVCM_KEY_NOT_AFTER</b> – поиск по дате/времении окончания действия личного ключа.
         * Значение <b>Spec</b> указывает на условие (Number), применяемое при поиске.
         * Возможные значения:
         *     - <b>AVCM_D_GREATER</b> – дата и время окончания действия искомого
         *     личного ключа должна быть больше или равна указанной дате и времени.
         *     - <b>AVCM_D_LESS</b> – дата и время окончания окончания искомого личного
         *     ключа должна быть меньше или равна указанной дате и времени.
         * Значение <b>Value</b>: дата и время. При этом дата и время дожны быть указаны для текущего часового пояса.
         * - <b>AVCM_SUBJECT_AS_STRING</b> – поиск по полному имени (X.509 Name) владельца сертификата в виде строки.
         * Значение <b>Value</b>: строка имени издателя
         * - <b>AVCM_SUBJECT_ATTR</b> – поиск по атрибуту имени (X.509 Name) владельца
         * сертификата в виде строки. При этом необходима передача идентификатора искомого объекта (поле <b>Spec</b>).
         * Значение <b>Spec</b>: строка идентификатора искомого объекта (OID).
         * Значение <b>Value</b>: строка атрибута владельца сертификата.
         * - <b>AVCM_PUB_KEY_ID</b> – поиск по идентификатору открытого ключа сертификата в виде строки шестнадцатиричных цифр.
         * Значение <b>Value</b>: строка идентификатора открытого ключа.
         * - <b>AVCM_PUB_KEY</b> – поиск по открытому ключу сертификата
         * Значение <b>Spec</b>: размер открытого ключа в байтах (Number).
         * Значение <b>Value</b>: открытый ключ (в виде последовательности байт).
         * - <b>AVCM_SUBJ_ALT_NAME_ATTR</b> – поиск по атрибуту альтернативного имени
         * (X.509 AltName) владельца сертификата в виде строки. При этом необходима
         * передача идентификатора искомого объекта (поле <b>Spec</b>).
         * Значение <b>Spec</b>: строка идентификатора искомого атрибута (OID).
         * Значение <b>Value</b>: строка атрибута альтернативного имени владельца сертификата.
         * - <b>AVCM_EXT_AS_STRING</b> – поиск по дополнению сертификата в виде строки
         * ASCIIZ. При этом необходима передача идентификатора искомого объекта (поле <b>Spec</b>).
         * Значение <b>Spec</b>: строка идентификатора искомого дополнения (OID).
         * Значение <b>Value</b>: строка значения искомого дополнения.
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_ALL_CERT</b> – данный флаг необходимо использовать при необходимости перебора не 
         * только корректных сертификатов, а всех имеющихся в хранилище сертификатов.
         * 
         * @param {avcmx.Parameters} [params] параметры отбора сертификатов
         * @param {Number} [flags] флаги
         * @return {avcmx.Certificates}
         */
        selectCerts: function (params, flags) {
            if (flags === undefined) flags = (typeof params === "number" ? params : 0);
            params = (!params || (params === flags)) ? instance.CreateParameters(0) : params.get();
            return this.factory(this.object.SelectCertificates(params, flags), "Certificates");
        },

        /**
         * Предназначен для создания объекта списка атрибутных сертификатов путем перебора и отбора 
         * атрибутных сертификатов в справочнике, удовлетворяющих определенным условиям и принадлежащих 
         * заданному сертификату открытого ключа. Условия для поиска передаются через объект параметров.
         * При этом следует отметить, что по умолчанию перебор осуществляется только среди
         * корректных атрибутных сертификатов, то есть для каждого найденного атрибутного
         * сертификата прозводится полная проверка его корректности. При необходимости можно
         * получить и сертификаты без проверки корректности, для этого нужно указать флаг <b>AVCMF_ALL_CERT</b>
         * 
         * Поиск атрибутных сертификатов для текущего сертификата сессии:
         * 
         *     conn = ... // create connection
         *     conn.selectAttrCerts(conn.ownCert());

         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_ALL_CERT</b> – данный флаг необходимо использовать при необходимости перебора не 
         * только корректных сертификатов, а всех имеющихся в хранилище сертификатов.
         * 
         * @param {avcmx.Certificate} holder сертификат открытого ключа, для которого будет производиться поиск атрибутных сертификатов.
         * @param {avcmx.Parameters} [params] параметры отбора сертификатов.
         * На данный момент нет поддерживаемых критериев.
         * @param {Number} [flags] флаги
         * @return {avcmx.AttributeCertificates}
         */
        selectAttrCerts: function (holder, params, flags) {
            if (flags === undefined) flags = (typeof params === "number" ? params : 0);
            params = (!params || (params === flags)) ? instance.CreateParameters(0) : params.get();
            return this.factory(this.object.SelectAttributeCertificates(holder.get(), params, flags), "AttributeCertificates");
        },

        /**
         * Предназначен для создания объекта списка сертификатов путем включения сертификатов, 
         * выбранных пользователем через диалог выбора сертификатов.
         * 
         * <b>Примечание: данный метод может отображать диалоги, что "подвесит" окно браузера и 
         * оно будет недоступно. Рекомендуется использовать асинхронный аналог {@link avcmx.Connection#selectCertsDlgAsync}</b>
         * 
         * Пример:
         * 
         *     conn = ... // create connection
         *     conn.selectCertsDlg("Выбор сертифитката", "Выберите сертификат");
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_ALL_CERT</b> – данный флаг необходимо использовать при необходимости перебора не 
         * только корректных сертификатов, а всех имеющихся в хранилище сертификатов.
         * - <b>AVCMF_ALL_CERT</b> – данный флаг необходимо использовать при необходимости показа не только 
         * корректных сертификатов, а всех сертификатов, имеющихся в хранилище сертификатов.
         * 
         * @param {String} caption название окна выбора сертификатов. В случае передачи
         * пустой строки будет показано название по умолчанию.
         * @param {String} label строка перед списком сертификатом. В случае передачи
         * пустой строки будет показана строка по умолчанию.
         * @param {Number} [flags] флаги 
         * @return {avcmx.Certificates}
         * @deprecated 1.1.1 Заменен на {@link avcmx.Connection#selectCertsDlgAsync}
         */
        selectCertsDlg: function (caption, label, flags) {
            flags = flags || 0;
            return this.factory(this.object.SelectCertificatesDialog(caption, label, flags), "Certificates");
        },

        /**
         * Предназначен для создания объекта списка сертификатов путем включения сертификатов, 
         * выбранных пользователем через диалог выбора сертификатов.
         * 
         * Пример:
         * 
         *     conn = ... // create connection
         *     conn.selectCertsDlgAsync("Выбор сертифитката", "Выберите сертификат", function (e, certs) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем certs
         *     });
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_ALL_CERT</b> – данный флаг необходимо использовать при необходимости перебора не 
         * только корректных сертификатов, а всех имеющихся в хранилище сертификатов.
         * - <b>AVCMF_ALL_CERT</b> – данный флаг необходимо использовать при необходимости показа не только 
         * корректных сертификатов, а всех сертификатов, имеющихся в хранилище сертификатов.
         * 
         * @param {String} caption название окна выбора сертификатов. В случае передачи
         * пустой строки будет показано название по умолчанию.
         * @param {String} label строка перед списком сертификатом. В случае передачи
         * пустой строки будет показана строка по умолчанию.
         * @param {Number} [flags] флаги 
         * @param {Function} fn функция для обработки созданного контекста или ошибки создания.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @param {avcmx.Certificates} fn.certs найденные сертификаты, либо undefined в случае ошибки.
         * @chainable
         * @since 1.1.1
         */
        selectCertsDlgAsync: function (caption, label, flags, fn) {
            if (!isFunction(fn)) {
                fn = flags;
                flags = 0;
            }
            this.object.SelectCertificatesDialogAsync(caption, label, flags, this.makeAsync(fn));
            return this;
        },

        /**
         * Предназначен для получения СОС из справочника сертификатов и СОС
         * 
         * Поиск СОС по полной строке имени издателя
         * 
         *     conn = ... // create connection
         *     issuerName = "CN=ПУЦ, OU=ПУЦ, O=ПУЦ, STREET=ПУЦ, L=ПУЦ, ST=ПУЦ, C=BY";
         *     conn.getCRL(avcmx().params().add(AVCM_CRL_ISSUER_SUBJECT, avcmx().blob().zttext(issuerName)));
         * 
         * На данный момент поддерживаются следующие параметры поиска:
         * 
         * - <b>AVCM_CRL_ISSUER_SUBJECT</b> – поиск по полному имени (X.509 Name)
         * издателя списка отозванных сертификатов в виде строки.
         * Значение <b>Value</b>: строка имени издателя.
         * 
         * @param {avcmx.Parameters} params параметры поиска СОС.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.CRL}
         */
        getCRL: function (params, flags) {
            flags = flags || 0;
            return this.factory(this.object.GetCRL(params.get(), flags));
        },

        /**
         * Предназначен для получения запроса на сертификат из справочника сертификатов и СОС.
         * 
         * Поиск запроса на сертификат по идентификатору открытого ключа
         * 
         *     conn = ... // create connection
         *     pubKeyId = "00112233445566778899AABBCCDDEEFF00112233";
         *     conn.getReq(avcmx().params().add(AVCM_PUB_KEY_ID, avcmx().blob().zttext(pubKeyId)));
         *     
         * На данный момент поддерживаются следующие параметры поиска:
         * 
         * - <b>AVCM_PUB_KEY_ID</b> – поиск по идентификатору открытого ключа запроса на
         * сертификат в виде строки в HEX-формате.
         * Значение <b>Value</b>: строка идентификатора открытого ключа
         * 
         * @param {avcmx.Parameters} params параметры поиска запроса.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Request}
         */
        getReq: function (params, flags) {
            flags = flags || 0;
            return this.factory(this.object.GetRequest(params.get(), flags));
        },

        /**
         * Предназначен для импорта сертификата открытого ключа или атрибутного 
         * сертификата из блока данных в справочник сертификатов и СОС.
         * 
         * @param {avcmx.Blob} blob сертификат в DER-кодировке.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Certificate|avcmx.AttributeCertificate}
         */
        importCert: function (blob, flags) {
            flags = flags || 0;
            return this.factory(this.object.ImportCertificate(blob.get(), flags));
        },

        /**
         * Предназначен для импорта СОС из блока данных в справочник сертификатов и СОС
         * 
         * @param {avcmx.Blob} blob СОС в DER-кодировке.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.CRL}
         */
        importCRL: function (blob, issuerCheck, flags) {
            if (flags === undefined) flags = (typeof issuerCheck === "number" ? issuerCheck : 0);
            if (!issuerCheck || issuerCheck === flags) issuerCheck = "";
            return this.factory(this.object.ImportCRL(blob.get(), issuerCheck, flags));
        },

        /**
         * Предназначен для импорта запроса на сертификат из блока данных в справочник сертификатов и СОС
         * 
         * @param {avcmx.Blob} blob запрос на сертификат в DER-кодировке.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Request}
         */
        importReq: function (blob, flags) {
            flags = flags || 0;
            return this.factory(this.object.ImportRequest(blob.get(), flags));
        },

        /**
         * Предназначен для импорта цепочки сертификатов и списков отозванных сертификатов в соответствующие 
         * справочники. Вызов данного метода может порождать диалоговые окна в зависимости от переданных параметров, 
         * например, если задано имя контейнера, то будет проиведена попытка импорта первого сертификата в
         * цепочке (обычно первым идет конечный сертифика пользователя) в личный справочник, что может привести 
         * к появлению диалога с вводом пароля, а также стандартного диалога Windows для подтверждения импорта корневого 
         * сертификата в список доверенных центров; если же имя контейнера не задано, то будет отображен мастер импорта
         * сертификатов (аналогично персональному менеджеру сертификатов).
         * 
         * @param {avcmx.Blob} blob цепочка сертификатов в DER-кодировке.
         * @param {String} [container] имя контейнера для импорта сертификата в личный справочник.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @chainable
         * @since 1.1.0
         */
        importChain: function (blob, container, flags) {
            if (flags === undefined) flags = (typeof container === "number" ? container : 0);
            if (!container || container === flags) container = "";
            this.object.ImportChain(blob.get(), container, flags);
            return this;
        },

        sign: function (blob, oid, flags) {
            flags = flags || 0;
            return this.factory(this.object.SignBlob(blob.get(), oid, flags));
        },

        /**
         * Предназначен для создания запроса на сертификат с помощью диалога.
         * 
         * <b>Примечание: данный метод может отображать диалоги, что "подвесит" окно браузера и 
         * оно будет недоступно. Рекомендуется использовать асинхронный аналог {@link avcmx.Connection#createReqDlgAsync}</b>
         * 
         * Создание запроса на сертификат с передачей шаблона запроса и карточки открытого ключа
         * 
         *     conn = ... // create connection
         *     tpl = ... // receive base64 template
         *     card = ... // receive base64 cards
         *     params = avcmx().params()
         *     blob = avcmx().blob().base64(tpl)
         *     params.add(AVCM_TEMPLATE_DATA, blob.zttext(blob.text()))
         *     blob.base64(cards)
         *     params.add(AVCM_CARDS_DATA, blob.zttext(blob.text()))
         *     conn.createReqDlg(params)
         * 
         * На данный момент поддерживаются следующие параметры генерации:
         * 
         * - <b>AVCM_TEMPLATE</b> – путь к файлу шаблона на сертификат. Если указан путь к 
         * шаблону, то мастер не будет предлагать пользователю выбор шаблона на сертификат.
         * Значение <b>Value</b>: строка пути к файлу шаблона запроса на сертификат.
         * - <b>AVCM_CERT_PROLONGATION</b> – сгенерировать запрос на продление
         * личного сертификата, с помощью которого был произведен вход в систему.
         * Значение <b>Value</b>: пустое.
         * - <b>AVCM_TEMPLATE_DATA</b> – данные шаблона запроса на сертификат.
         * Значение <b>Value</b>: строка с шаблоном запроса на сертификат.
         * - <b>AVCM_CARDS_DATA</b> – данные шаблона карточки открытого ключа.
         * Значение <b>Value</b>: строка с шиблоном карточки открытого ключа.
         * 
         * @param {avcmx.Parameters} [params] параметры генерации запроса.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Request}
         * @deprecated 1.1.1 Заменен на {@link avcmx.Connection#createReqDlgAsync}
         */
        createReqDlg: function (params, flags) {
            if (flags === undefined) flags = (typeof params === "number" ? params : 0);
            params = (!params || (params === flags)) ? instance.CreateParameters(0) : params.get();
            return this.factory(this.object.CreateRequestDialog(params, flags));
        },


        /**
         * Предназначен для создания запроса на сертификат с помощью диалога.
         * 
         * Создание запроса на сертификат с передачей шаблона запроса и карточки открытого ключа
         * 
         *     conn = ... // create connection
         *     tpl = ... // receive base64 template
         *     card = ... // receive base64 cards
         *     params = avcmx().params()
         *     blob = avcmx().blob().base64(tpl)
         *     params.add(AVCM_TEMPLATE_DATA, blob.zttext(blob.text()))
         *     blob.base64(cards)
         *     params.add(AVCM_CARDS_DATA, blob.zttext(blob.text()))
         *     conn.createReqDlgAsync(params, function (e, req) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем req
         *     })
         * 
         * На данный момент поддерживаются следующие параметры генерации:
         * 
         * - <b>AVCM_TEMPLATE</b> – путь к файлу шаблона запроса на сертификат. Если указан путь к 
         * шаблону, то мастер не будет предлагать пользователю выбор шаблона на сертификат.
         * Значение <b>Value</b>: строка пути к файлу шаблона запроса на сертификат.
         * - <b>AVCM_CERT_PROLONGATION</b> – сгенерировать запрос на продление
         * личного сертификата, с помощью которого был произведен вход в систему.
         * Значение <b>Value</b>: пустое.
         * - <b>AVCM_TEMPLATE_DATA</b> – данные шаблона запроса на сертификат.
         * Значение <b>Value</b>: строка с шаблоном запроса на сертификат.
         * - <b>AVCM_CARDS_DATA</b> – данные шаблона карточки открытого ключа.
         * Значение <b>Value</b>: строка с шиблоном карточки открытого ключа.
         * 
         * @param {avcmx.Parameters} [params] параметры генерации запроса.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @param {Function} fn функция для обработки созданного контекста или ошибки создания.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @param {avcmx.Request} fn.req запрос на сертификат, либо undefined в случае ошибки.
         * @chainable
         * @since 1.1.1
         */
        createReqDlgAsync: function (params, flags, fn) {
            if (isFunction(fn)) params = params.get();
            else {
                if (isFunction(flags)) {
                    fn = flags;
                    flags = (typeof params === "number" ? params : 0);
                    params = (!params || (params === flags)) ? instance.CreateParameters(0) : params.get();
                } else {
                    fn = params;
                    flags = 0;
                    params = instance.CreateParameters(0);
                }
            }
            this.object.CreateRequestDialogAsync(params, flags, this.makeAsync(fn));
            return this;
        },

        /**
         * Предназначен для создания объекта сертификатов путем перебора и отбора сертификатов в справочнике, 
         * удовлетворяющих определенным условиям. Условия для поиска передаются через строку запроса (AvCryptSQL).
         * При этом следует отметить, что по умолчанию перебор осуществляется только среди корректных сертификатов, 
         * то есть для каждого найденного сертификата прозводится полная проверка его корректности. 
         * При необходимости можно получить и сертификаты без проверки корректности, для этого нужно указать флаг <b>AVCMF_ALL_CERT</b>.
         * Если строка запроса отсутствует, то будут выбраны все сертификаты.
         * 
         * Поиск сертификата по идентификатору открытого ключа
         * 
         *     conn = ... // create connection
         *     conn.queryCerts("KeyId='00112233445566778899AABBCCDDEEFF00112233'", AVCMF_ALL_CERT);
         *     
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_ALL_CERT</b> – данный флаг необходимо использовать при необходимости перебора не 
         * только корректных сертификатов, а всех имеющихся в хранилище сертификатов.
         * 
         * @param {String} [csql] строка запроса (AvCryptSQL)
         * @param {Number} [flags] флаги.
         * @return {avcmx.Certificates}
         * @since 1.1.1
         */
        queryCerts: function (csql, flags) {
            if (flags === undefined) flags = (typeof csql === "number" ? csql : 0);
            csql = (!csql || (csql === flags)) ? "" : csql;
            return this.factory(this.object.QueryCertificates(csql, flags));
        },

        /**
         * Предназначен для создания объекта запросов путем перебора и отбора запросов в справочнике, 
         * удовлетворяющих определенным условиям. Условия для поиска передаются через строку запроса (AvCryptSQL).
         * Если строка запроса отсутствует, то будут выбраны все запросы.
         * 
         * Получение всех имеющихся в справочнике запросов
         * 
         *     conn = ... // create connection
         *     conn.queryReqs();
         *     
         * Поиск запроса по идентификатору открытого ключа
         * 
         *     conn = ... // create connection
         *     conn.queryReqs("KeyId='00112233445566778899AABBCCDDEEFF00112233'");
         *     
         * @param {String} [csql] строка запроса (AvCryptSQL)
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Requests}
         * @since 1.1.1
         */
        queryReqs: function (csql, flags) {
            if (flags === undefined) flags = (typeof csql === "number" ? csql : 0);
            csql = (!csql || (csql === flags)) ? "" : csql;
            return this.factory(this.object.QueryRequests(csql, flags));
        }
    });

    /**
     * @class avcmx.Message
     * Предназначен для работы с криптографическими функциями. У них есть некоторые общие методы
     * @typevar T
     * @extends avcmxobject.<native.AvCMX.Message>
     */
    avcmx.Message.prototype = extend(avcmx.Message.prototype, {
        /**
         * Предназначен для подписания сообщения. При этом создаѐтся подписанное сообщения в формате 
         * PKCS#7 SignedData, подписывается сертификатом, на котором была открыта сессия, 
         * (в зависимости от флага) в содержимое помещается Blob текущего сообщения, и в поле 
         * ContentType устанавливается тип, соответствующий текущему сообщению (для Raw – Data; 
         * Signed – SignedData; Encrypted – EnvelopedData).
         * 
         * <b>Примечание: данный метод может отображать диалоги, что "подвесит" окно браузера и 
         * оно будет недоступно. Рекомендуется использовать асинхронный аналог {@link avcmx.Message#signAsync}</b>
         * 
         * Создание подписанного сообщения (attached)
         * 
         *     conn = ... // create connection
         *     conn.message(avcmx().blob().text("123")).sign()
         * 
         * Создание подписанного сообщения (detached) с сертификатом подписанта
         * 
         *     conn = ... // create connection
         *     conn.message(avcmx().blob().text("123")).sign(AVCMF_DETACHED | AVCMF_ADD_SIGN_CERT)
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_DETACHED</b> – подписанное содержимое не будет включено в сообщение. 
         * В таком случае при проверке сообщения необходимо будет дополнительно установить 
         * содержимое методом SetContent.
         * - <b>AVCMF_ADD_ALL_CERT</b> – в выходное сообщение будут включены все необходимые сертификаты и СОС.
         * - <b>AVCMF_ADD_SIGN_CERT</b> – в выходное сообщение будет включен только сертификат подписавшего.
         * - <b>AVCMF_REPEAT_AUTHENTICATION</b> – перед выработкой ЭЦП система потребует повторного ввода 
         * пароля к контейнеру личных ключей, проверит наличие контейнера на вставленном носителе и 
         * убедится в правильности введенного пароля.
         * 
         * @param {Number} [flags] флаги.
         * @return {avcmx.SignedMessage}
         * @deprecated 1.1.1 заменен на {@link avcmx.Message#signAsync}
         */
        sign: function (flags) {
            flags = flags || 0;
            return this.factory(this.object.Sign(flags));
        },

        /**
         * Предназначен для подписания сообщения. При этом создаѐтся подписанное сообщения в формате 
         * PKCS#7 SignedData, подписывается сертификатом, на котором была открыта сессия, 
         * (в зависимости от флага) в содержимое помещается Blob текущего сообщения, и в поле 
         * ContentType устанавливается тип, соответствующий текущему сообщению (для Raw – Data; 
         * Signed – SignedData; Encrypted – EnvelopedData).
         * 
         * Создание подписанного сообщения (attached)
         * 
         *     conn = ... // create connection
         *     conn.message(avcmx().blob().text("123")).signAsync(function (e, signed) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем signed
         *     })
         * 
         * Создание подписанного сообщения (detached) с сертификатом подписанта
         * 
         *     conn = ... // create connection
         *     conn.message(avcmx().blob().text("123")).signAsync(AVCMF_DETACHED | AVCMF_ADD_SIGN_CERT, function (e, signed) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем signed
         *     })
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_DETACHED</b> – подписанное содержимое не будет включено в сообщение. 
         * В таком случае при проверке сообщения необходимо будет дополнительно установить 
         * содержимое методом SetContent.
         * - <b>AVCMF_ADD_ALL_CERT</b> – в выходное сообщение будут включены все необходимые сертификаты и СОС.
         * - <b>AVCMF_ADD_SIGN_CERT</b> – в выходное сообщение будет включен только сертификат подписавшего.
         * - <b>AVCMF_REPEAT_AUTHENTICATION</b> – перед выработкой ЭЦП система потребует повторного ввода 
         * пароля к контейнеру личных ключей, проверит наличие контейнера на вставленном носителе и 
         * убедится в правильности введенного пароля.
         * 
         * @param {Number} [flags] флаги.
         * @param {Function} fn функция для обработки сообщения или ошибки создания.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @param {avcmx.SignedMessage} fn.signed объект сообщения, либо undefined в случае ошибки.
         * @chainable
         * @since 1.1.1
         */
        signAsync: function (flags, fn) {
            if (isFunction(flags)) {
                fn = flags;
                flags = 0;
            }
            this.object.SignAsync(flags, this.makeAsync(fn));
            return this;
        },

        /**
         * Предназначен для зашифрования сообщения. При этом создаѐтся подписанное сообщения в формате 
         * PKCS#7 EncryptedData, и в него помещается в качестве содержимого Blob текущего сообщения, 
         * зашифрованный на все сертификаты, находящиеся в переданном объекте сертификатов. В поле 
         * ContentType устанавливается тип, соответствующий текущему сообщению (для Raw – Data; Signed – SignedData;
         * Encrypted – EnvelopedData).
         * 
         * Зашифрование сообщения
         * 
         *     conn = ... // create connection
         *     certs = ... // select certificates
         *     conn.message(avcmx().blob().text("123")).encrypt(certs)
         * 
         * @param {avcmx.Certificates} certs множество сертификатов получателей. Сообщение будет зашифровано 
         * на все сертификаты, которые присутствуют в данном объекте; поэтому в случае нахождения там хотя бы 
         * одного сертификата, не предназначенного для зашифрования, произойдѐт ошибка.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.EncryptedMessage}
         */
        encrypt: function (certs, flags) {
            flags = flags || 0;
            var tmp = this.object.Encrypt(certs.get(), flags);
            if (avcmx.oldActiveX && !tmp) {
                return this;
            } else {
                return this.factory(tmp);
            }
        },
        
        /**
         * Предназначен для получения сообщения в экспортируемом виде. В случае подписанного и зашифрованного сообщения, 
         * возвращается DER закодированный PKCS#7; в случае «сырого» сообщения возвращается его содержимое.
         * @return {avcmx.Blob}
         */
        val: function () {
            return this.factory(this.object.Blob);
        },

        /**
         * Предназначен для добавления атрибутного сертификата к открытому для подписания сообщению.
         * 
         * @param {avcmx.AttributeCertificate} acert добавляемый атрибутный сертификат.
         * @chainable
         * @since 1.1.4
         */
        attrCert: function (acert) {
            this.object.AttributeCertificate = acert.get();
            return this;
        },

        /**
         * Предназначен для проверки является ли данное сообщение "сырым"
         * @return {Boolean}
         */
        isRaw: function () {
            return this.object.IsRaw();
        },

        /**
         * Предназначен для проверки является ли данное сообщение подписанным
         * @return {Boolean}
         */
        isSigned: function () {
            return this.object.IsSigned();
        },

        /**
         * Предназначен для проверки является ли данное сообщение зашифрованным
         * @return {Boolean}
         */
        isEncrypted: function () {
            return this.object.IsEncrypted();
        },

        /**
         * Предназначен для добавления блоков данных к содержимому сообщения. Данный метод может быть использован только 
         * для сообщений созданных с использованием флагов <b>AVCMF_OPEN_FOR_SIGN</b>, <b>AVCMF_OPEN_FOR_VERIFYSIGN</b>, 
         * <b>AVCMF_OPEN_FOR_ENCRYPT</b>, <b>AVCMF_OPEN_FOR_DECRYPT</b> с помощью метода {@link avcmx.Connection#message}.
         * 
         * <b>Примечание: данный метод предназначен для работы с detached сообщениями (созданные с использованием флага 
         * AVCMF_DETACHED) и не возвращает обработанных данных. Использование метода для работы с зашифрованными сообщениями 
         * большого размера не рекомендуется. При вызове завершающих методов {@link avcmx.Message#final} или 
         * {@link avcmx.Message#finalAsync} у сообщения, данные которому передавались с помощью данного метода, будет возвращено
         * целое подписанное или зашифрованное сообщение. Для обработки блоков данных в любом режиме и получения результата 
         * рекомендуется использовать асинхронный аналог {@link avcmx.Message#updateAsync}</b>.
         * 
         * @param {avcmx.Blob} blob добавляемое содержимое сообщения.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @chainable
         */
        update: function (blob, flags) {
            flags = flags || 0;
            this.object.Update(blob.get(), flags);
            return this;
        },

        /**
         * Предназначен для добавления блоков данных к содержимому сообщения и обработки результата. Данный метод может 
         * быть использован только для сообщений созданных с использованием флагов <b>AVCMF_OPEN_FOR_SIGN</b>, 
         * <b>AVCMF_OPEN_FOR_VERIFYSIGN</b>, <b>AVCMF_OPEN_FOR_ENCRYPT</b>, <b>AVCMF_OPEN_FOR_DECRYPT</b> с помощью 
         * метода {@link avcmx.Connection#message}.
         * 
         * @param {avcmx.Blob} blob добавляемое содержимое сообщения.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @param {Function} fn функция для обработки выходных данных или ошибки.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @param {avcmx.Blob} fn.blob объект выходных данных, либо undefined в случае ошибки.
         * @chainable
         * @since 1.1.3
         */
        updateAsync: function (blob, flags, fn) {
            if (isFunction(flags)) {
                fn = flags;
                flags = 0;
            }
            this.object.UpdateAsync(blob.get(), flags, this.makeAsync(fn));
            return this;
        },

        /**
         * Предназначен для добавления завершающего блока данных к содержимому сообщения для последующего подписания 
         * или проверки подписи. Данный метод может быть использован только для сообщений созданных с использованием флагов
         * (<b>AVCMF_OPEN_FOR_SIGN</b> | <b>AVCMF_DETACHED</b>) или (<b>AVCMF_OPEN_FOR_VERIFYSIGN</b> | <b>AVCMF_DETACHED</b>) 
         * с помощью метода {@link avcmx.Connection#message}.
         * 
         * <b>Примечание: данный метод может отображать диалоги, что "подвесит" окно браузера и 
         * оно будет недоступно. Рекомендуется использовать асинхронный аналог {@link avcmx.Message#finalAsync}</b>
         * 
         * Подписание сообщения состоящего из двух блоков
         * 
         *     conn = ... // create connection
         *     msg = conn.message(AVCMF_OPEN_FOR_SIGN | AVCMF_DETACHED)
         *     signed = msg.update(avcmx().blob().text("123"))
         *         .final(avcmx().blob().text("321"))
         *     // signed instanceof avcmx.SignedMessage == true
         * 
         * Проверка подписи под сообщением состоящего из двух блоков
         * 
         *     conn = ... // create connection
         *     signedData = ... // create signed data blob
         *     signed = conn.message(signedData, AVCMF_OPEN_FOR_VERIFYSIGN | AVCMF_DETACHED)
         *     valid = signed.update(avcmx().blob().text("123"))
         *         .final(avcmx().blob().text("321")).verify()
         * 
         * @param {avcmx.Blob} blob добавляемое содержимое сообщения.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.SignedMessage|avcmx.EncryptedMessage}
         * @deprecated 1.1.1 заменен на {@link avcmx.Message#finalAsync}
         */
        final: function (blob, flags) {
            flags = flags || 0;
            var tmp = this.object.Final(blob.get(), flags);
            if (avcmx.oldActiveX && !tmp) {
                return this;
            } else {
                return this.factory(tmp);
            }
        },
        
        /**
         * Предназначен для добавления завершающего блока данных к содержимому сообщения и обработки результата. Данный метод может 
         * быть использован только для сообщений созданных с использованием флагов <b>AVCMF_OPEN_FOR_SIGN</b>, 
         * <b>AVCMF_OPEN_FOR_VERIFYSIGN</b>, <b>AVCMF_OPEN_FOR_ENCRYPT</b>, <b>AVCMF_OPEN_FOR_DECRYPT</b> с помощью 
         * метода {@link avcmx.Connection#message}.
         * 
         * Тип результата может отличаться в зависимости от использованного метода для добавления блоков:
         * 
         * - при использовании метода {@link avcmx.Message#update} результатом будет объект сообщения
         * - при использовании метода {@link avcmx.Message#updateAsync} результатом будет объект завершающего блока обработанных данных
         * 
         * Подписание сообщения состоящего из двух блоков (detached)
         * 
         *     conn = ... // create connection
         *     msg = conn.message(AVCMF_OPEN_FOR_SIGN | AVCMF_DETACHED)
         *     msg.update(avcmx().blob().text("123"))
         *         .finalAsync(avcmx().blob().text("321"), function (e, msg) {
         *             if (e) { alert(e.message); return; }
         *             // обрабатываем msg - подписанное сообщение
         *         })
         * 
         * Подписание сообщения состоящего из двух блоков (attached)
         * 
         *     conn = ... // create connection
         *     msg = conn.message(AVCMF_OPEN_FOR_SIGN)
         *     msg.updateAsync(avcmx().blob().text("123"), function (e, blob) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем blob - первый блок подписанного сообщения
         *     }).finalAsync(avcmx().blob().text("321"), function (e, blob) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем blob - завершающий блок подписанного сообщения
         *     })
         * 
         * @param {avcmx.Blob} blob добавляемое содержимое сообщения.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @param {Function} fn функция для обработки сообщения или ошибки создания.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @param {avcmx.SignedMessage|avcmx.EncryptedMessage|avcmx.Blob} fn.msgOrBlob объект результата, либо undefined в случае ошибки.
         * @chainable
         * @since 1.1.1
         */
        finalAsync: function (blob, flags, fn) {
            if (isFunction(flags)) {
                fn = flags;
                flags = 0;
            }
            this.object.FinalAsync(blob.get(), flags, this.makeAsync(fn));
            return this;
        },

        /**
         * Предназначен установки хеша от сообщения, а не данных целиком, для последующего подписания или проверки подписи.
         * Данный метод может быть использован только для сообщений созданных с использованием флагов
         * (<b>AVCMF_OPEN_FOR_SIGN</b> | <b>AVCMF_DETACHED</b>) или (<b>AVCMF_OPEN_FOR_VERIFYSIGN</b> | <b>AVCMF_DETACHED</b>) 
         * с помощью метода {@link avcmx.Connection#message}.
         * 
         * <b>Примечание: данный метод может отображать диалоги, что "подвесит" окно браузера и 
         * оно будет недоступно. Рекомендуется использовать асинхронный аналог {@link avcmx.Message#finalHashAsync}</b>
         * 
         * Подписание хеша от сообщения
         * 
         *     conn = ... // create connection
         *     hash = "00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF"
         *     msg = conn.message(AVCMF_OPEN_FOR_SIGN | AVCMF_DETACHED)
         *     signed = msg.finalHash(avcmx().blob().hex(hash))
         *     // signed instanceof avcmx.SignedMessage == true
         *     
         * Проверка подписи под сообщением от хеша
         * 
         *     conn = ... // create connection
         *     signedData = ... // create signed data blob
         *     hash = "00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF"
         *     signed = conn.message(signedData, AVCMF_OPEN_FOR_VERIFYSIGN | AVCMF_DETACHED)
         *     valid = signed.finalHash(avcmx().blob().hex(hash)).verify()
         * 
         * @param {avcmx.Blob} blob хеш от сообщения.
         * @return {avcmx.SignedMessage}
         * @deprecated 1.1.1 заменен на {@link avcmx.Message#finalHashAsync}
         */
        finalHash: function (blob) {
            var tmp = this.object.FinalHashed(blob.get());
            if (avcmx.oldActiveX && !tmp) {
                return this;
            } else {
                return this.factory(tmp);
            }
        },
        
        /**
         * Предназначен установки хеша от сообщения, а не данных целиком, для последующего подписания или проверки подписи.
         * Данный метод может быть использован только для сообщений созданных с использованием флагов
         * (<b>AVCMF_OPEN_FOR_SIGN</b> | <b>AVCMF_DETACHED</b>) или (<b>AVCMF_OPEN_FOR_VERIFYSIGN</b> | <b>AVCMF_DETACHED</b>) 
         * с помощью метода {@link avcmx.Connection#message}.
         * 
         * Подписание хеша от сообщения
         * 
         *     conn = ... // create connection
         *     hash = "00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF"
         *     msg = conn.message(AVCMF_OPEN_FOR_SIGN | AVCMF_DETACHED)
         *     msg.finalHashAsync(avcmx().blob().hex(hash), function (e, signed) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем signed
         *     })
         *     
         * @param {avcmx.Blob} blob хеш от сообщения.
         * @param {Function} fn функция для обработки сообщения или ошибки создания.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @param {avcmx.SignedMessage} fn.signed объект сообщения, либо undefined в случае ошибки.
         * @chainable
         * @since 1.1.1
         */
        finalHashAsync: function (blob, fn) {
            this.object.FinalHashedAsync(blob.get(), this.makeAsync(fn));
            return this;
        }
    });

    /**
     * @class avcmx.RawMessage
     * Предназначен для работы с данными не в формате PKCS#7; например, для подписания или зашифрования,
     * или после расшифрования
     * @extends avcmx.Message.<native.AvCMX.RawMessage>
     */
    avcmx.RawMessage.prototype = extend(avcmx.RawMessage.prototype, {
        /**
         * Предназначен для установки и получения содержимого сообщения. Оно также устанавливается при 
         * создании сообщения методом {@link avcmx.Connection#message} (параметр blob)
         * 
         * @param {avcmx.Blob} blob новое или добавляемое содержимое сообщения.
         * @return {avcmx.Blob|avcmx.RawMessage} при установке данных возвращается объект сообщения, при 
         * получении - объект блоб.
         */
        content: function (blob) {
            if (blob) {
                this.object.Content = blob.get();
                return this;
            } else {
                return this.factory(this.object.Content);
            }
        },

        /**
         * Предназначен для добавления данных к уже установленному содержимому сообщения
         * 
         * @param {avcmx.Blob} blob добавляемое содержимое сообщения.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @chainable
         */
        append: function (blob, flags) {
            flags = flags || 0;
            this.object.AppendContent(blob.get(), flags);
            return this;
        }
    });

    /**
     * @class avcmx.SignedMessage
     * Предназначен для работы с данными в формате PKCS#7 SignedData; например, для проверки подписи под 
     * текстом, или для импортирования сертификатов.
     * @extends avcmx.Message.<native.AvCMX.SignedMessage>
     */
    avcmx.SignedMessage.prototype = extend(avcmx.SignedMessage.prototype, {
        /**
         * Предназначен для установки и получения содержимого сообщения. Оно также устанавливается при 
         * создании сообщения методом {@link avcmx.Connection#message} (параметр blob)
         * 
         * @param {avcmx.Blob} blob новое или добавляемое содержимое сообщения.
         * @return {avcmx.Blob|avcmx.SignedMessage} при установке данных возвращается объект сообщения, при 
         * получении - объект блоб.
         */
        content: function (blob) {
            if (blob) {
                this.object.Content = blob.get();
                return this;
            } else {
                return this.factory(this.object.Content);
            }
        },

        /**
         * Предназначен для добавления данных к уже установленному содержимому сообщения
         * 
         * @param {avcmx.Blob} blob добавляемое содержимое сообщения.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @chainable
         */
        append: function (blob, flags) {
            flags = flags || 0;
            this.object.AppendContent(blob.get(), flags);
            return this;
        },

        /**
         * Возвращает количество подписей в подписанном сообщении.
         * @return {Number}
         */
        signsCount: function () {
            return parseInt(this.object.SignsCount);
        },

        /**
         * Предназначен для добавления подписи к подписанному сообщению. При этом установленное содержимое 
         * подписывается сертификатом, на котором был произведѐн вход в сессию, и полученная 
         * ЭЦП добавляется к сообщению.
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_ADD_ALL_CERT</b> – в выходное сообщение будут включены все необходимые сертификаты и СОС.
         * - <b>AVCMF_ADD_SIGN_CERT</b> – в выходное сообщение будет включен только сертификат подписавшего.
         * - <b>AVCMF_REPEAT_AUTHENTICATION</b> – перед выработкой ЭЦП система потребует повторного ввода пароля 
         * к контейнеру личных ключей, проверит наличие контейнера на вставленном носителе и убедится в правильности введенного пароля.
         * 
         * @param {Number} [flags] флаги.
         * @chainable
         */
        coSign: function (flags) {
            flags = flags || 0;
            this.object.AddSign(flags);
            return this;
        },

        /**
         * Предназначен для проверки всех подписей в подписанном сообщении. При этом проверяются все подписи, 
         * которые присутствуют в сообщении. Метод завершится успешно только в том случае, если все подписи 
         * можно проверить, и они верны.
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_VERIFY_ON_SIGN_DATE</b> – проверять ЭЦП на дату выработки электронной подписи, а не на текущую дату.
         * <b>Внимание! Контроль подлинности даты выработки ЭЦП в электронном сообщении должен обеспечиваться иными средствами.</b>
         * - <b>AVCMF_NO_CERT_VERIFY</b> – не проверять доверие к сертификату подписавшего. При указании этого флага не 
         * будет производится проверка цепочки сертификатов до сертификата корневого ЦС. Также не будет производится поиск
         * сертификата в СОС центра сертификации.
         * <b>Внимание! Целостность справочников сертификатов при проверке ЭЦП с указанным флагом AVCMF_NO_CERT_VERIFY должна 
         * контролироваться иными средствами.</b>
         * 
         * @param {Number} [flags] флаги.
         * @return {Boolean}
         */
        verify: function (flags) {
            flags = flags || 0;
            try {
                this.object.Verify(flags);
                return true;
            } catch (e) {
                if (AvCMXError.lastErrorIs(avcmx.constants.AVCMR_SIGN_INVALID)) {
                    return false;
                } else {
                    throw e;
                }
            }
        },

        /**
         * Предназначен для получения объектов отдельных подписей сообщения для последующей обработки (например, 
         * получения сертификатов подписавших, либо проверки отдельных подписей). Индексируется целым числом от 0 до 
         * {@link avcmx.SignedMessage#signsCount} – 1.
         * 
         * Получение первой подписи
         * 
         *      signedData = ... // create signed data blob
         *      signed = conn.message(signedData)
         *     signed.signs(0)
         *     signed.signs()[0]
         *     
         * Получение всех подписей по индексу
         * 
         *      signedData = ... // create signed data blob
         *      signed = conn.message(signedData)
         *     for (var i = 0; i < signed.signsCount(); i++) {
         *         signed.signs(i)
         *     }
         *     
         * Получение всех подписей и перебор
         * 
         *      signedData = ... // create signed data blob
         *      signed = conn.message(signedData)
         *      signs = signed.signs()
         *     for (var i = 0; i < signs.length; i++) {
         *         signs[i]
         *     }
         * 
         * @param {Number} [index] номер подписи, которую нужно получить (от 0).
         * @return {avcmx.Sign|avcmx.Sign[]} возвращает объект подписи если передан индекс, иначе - список всех подписей
         */
        signs: function (index) {
            if (index === undefined) {
                if (this.signsCache === undefined) {
                    this.signsCache = [];
                    for (var i = 0; i < this.object.SignsCount; i++) {
                        this.signsCache.push(this.factory(this.object.Signs(i)));
                    }
                }
                return this.signsCache;
            } else {
                return this.signsCache ? this.signsCache[index] : this.factory(this.object.Signs(index));
            }
        },

        /**
         * Предназначен для импортирования сертификатов и СОС из подписанного сообщения в справочник сертификатов и 
         * СОС. В зависимости от флагов, возможен интерактивный импорт (с выводом диалога выбора импортируемых
         * сертификатов и СОС; по умолчанию), либо безусловный.
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_IMPORT_ALL_CERTS</b> – импортировать все сертификаты и СОС без вывода диалогового окна.
         * - <b>AVCMF_IMPORT_CRL</b> – импортировать все необходимые СОС без вывода диалогового окна.
         *  
         * @param {Number} [flags] флаги.
         * @chainable
         */
        importCerts: function (flags) {
            flags = flags || 0;
            this.object.Import(flags);
            return this;
        },

        /**
         * Предназначен для получения объекта вложенного сообщения (подписанного содержимого). В случае отсутствия 
         * содержимого (например, при отделѐнной (detached) подписи), получение значения свойства вызовет ошибку.
         * @return {avcmx.RawMessage|avcmx.SignedMessage|avcmx.EncryptedMessage}
         */
        inner: function () {
            return this.factory(this.object.InnerMessage);
        }
    });

    /**
     * @class avcmx.EncryptedMessage
     * Предназначен для работы с данными в формате PKCS#7 EncryptedData; например, для расшифрования данных.
     * @extends avcmx.Message.<native.AvCMX.EncryptedMessage>
     */
    avcmx.EncryptedMessage.prototype = extend(avcmx.EncryptedMessage.prototype, {
        /**
         * Предназначен для расшифрования зашифрованного сообщения. Сообщение может быть успешно расшифровано 
         * только в том случае, если оно зашифровано в том числе и на тот сертификат, которым был произведѐн вход в сессию.
         * В случае успешного расшифрования будет возвращен объект сообщения соответствующего типа.
         * 
         * <b>Примечание: данный метод может отображать диалоги, что "подвесит" окно браузера и 
         * оно будет недоступно. Рекомендуется использовать асинхронный аналог {@link avcmx.Message#decryptAsync}</b>
         * 
         * Расшифрование сообщения
         * 
         *     conn = ... // create connection
         *     encryptedData = ... // create encrypted data blob
         *     conn.message(encryptedData).decrypt()
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.RawMessage|avcmx.SignedMessage|avcmx.EncryptedMessage}
         * @deprecated 1.1.1 заменен на {@link avcmx.Message#decryptAsync}
         */
        decrypt: function (flags) {
            flags = flags || 0;
            return this.factory(this.object.Decrypt(flags));
        },
        
        /**
         * Предназначен для расшифрования зашифрованного сообщения. Сообщение может быть успешно расшифровано 
         * только в том случае, если оно зашифровано в том числе и на тот сертификат, которым был произведѐн вход в сессию.
         * В случае успешного расшифрования будет возвращен объект сообщения соответствующего типа.
         * 
         * Расшифрование сообщения
         * 
         *     conn = ... // create connection
         *     encryptedData = ... // create encrypted data blob
         *     conn.message(encryptedData).decryptAsync(function (e, msg) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем msg
         *     })
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @param {Function} fn функция для обработки сообщения или ошибки создания.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @param {avcmx.RawMessage|avcmx.SignedMessage|avcmx.EncryptedMessage} fn.msg объект сообщения, либо undefined в случае ошибки.
         * @chainable
         * @since 1.1.1
         */
        decryptAsync: function (flags) {
            if (isFunction(flags)) {
                fn = flags;
                flags = 0;
            }
            this.object.DecryptAsync(flags, this.makeAsync(fn));
            return this;
        },

        /**
         * Предназначен для расшифрования зашифрованного сообщения и упрощѐнного получения расшифрованного содержимого.
         * Сообщение может быть успешно расшифровано только в том случае, если оно зашифровано в том числе и на тот 
         * сертификат, которым был произведѐн вход в сессию. В случае успешного расшифрования будет возвращено значение свойства Blob
         * расшифрованного вложенного сообщения.
         * 
         * <b>Примечание: данный метод может отображать диалоги, что "подвесит" окно браузера и 
         * оно будет недоступно. Рекомендуется использовать асинхронный аналог {@link avcmx.Message#contentAsync}</b>
         * 
         * Расшифрование сообщения и получение содержимого
         * 
         *     conn = ... // create connection
         *     encryptedData = ... // create encrypted data blob
         *     conn.message(encryptedData).content()
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Blob}
         * @deprecated 1.1.1 заменен на {@link avcmx.Message#contentAsync}
         */
        content: function (flags) {
            flags = flags || 0;
            return this.factory(this.object.DecryptAndGetContent(flags));
        },
        
        /**
         * Предназначен для расшифрования зашифрованного сообщения и упрощѐнного получения расшифрованного содержимого.
         * Сообщение может быть успешно расшифровано только в том случае, если оно зашифровано в том числе и на тот 
         * сертификат, которым был произведѐн вход в сессию. В случае успешного расшифрования будет возвращено значение свойства Blob
         * расшифрованного вложенного сообщения.
         * 
         * Расшифрование сообщения и получение содержимого
         * 
         *     conn = ... // create connection
         *     encryptedData = ... // create encrypted data blob
         *     conn.message(encryptedData).contentAsync(function (e, blob) {
         *         if (e) { alert(e.message); return; }
         *         // обрабатываем blob
         *     })
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @param {Function} fn функция для обработки данных сообщения или ошибки создания.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @param {avcmx.Blob} fn.blob объект данных сообщения, либо undefined в случае ошибки.
         * @chainable
         * @since 1.1.1
         */
        contentAsync: function (flags, fn) {
            if (isFunction(flags)) {
                fn = flags;
                flags = 0;
            }
            this.object.DecryptAndGetContentAsync(flags, this.makeAsync(fn));
            return this;
        }
    });

    /**
     * @class avcmx.Sign
     * Предназначен для работы с отдельными подписями в подписанных сообщениях PKCS#7 SignedMessage. Например,
     * для получения данных подписи, либо для еѐ проверки.
     * @extends avcmxobject.<native.AvCMX.Sign>
     */
    avcmx.Sign.prototype = extend(avcmx.Sign.prototype, {
        /**
         * Предназначен для проверки отдельной подписи.
         * 
         * На данный момент поддерживаются следующие флаги:
         * 
         * - <b>AVCMF_VERIFY_ON_SIGN_DATE</b> – проверять ЭЦП на дату выработки электронной подписи, а не на текущую дату.
         * <b>Внимание! Контроль подлинности даты выработки ЭЦП в электронном сообщении должен обеспечиваться иными средствами.</b>
         * - <b>AVCMF_NO_CERT_VERIFY</b> – не проверять доверие к сертификату подписавшего. При указании этого флага не 
         * будет производится проверка цепочки сертификатов до сертификата корневого ЦС. Также не будет производится поиск
         * сертификата в СОС центра сертификации.
         * <b>Внимание! Целостность справочников сертификатов при проверке ЭЦП с указанным флагом AVCMF_NO_CERT_VERIFY должна 
         * контролироваться иными средствами.</b>
         * 
         * @param {Number} [flags] флаги.
         * @return {Boolean}
         */
        verify: function (flags) {
            flags = flags || 0;
            try {
                this.object.Verify(flags);
                return true;
            } catch (e) {
                if (AvCMXError.lastErrorIs(avcmx.constants.AVCMR_SIGN_INVALID)) {
                    return false;
                } else {
                    throw e;
                }
            }
        },

        /**
         * Предназначен для отображения окна информации о подписи.
         * 
         * <b>Примечание: при вызове без параметров данный метод отображает диалог, что "подвесит" окно браузера и 
         * оно будет недоступно. Чтобы этого не произошло необходимо передать в параметры функцию для обработки ошибки.</b>
         * 
         * Пример:
         * 
         *      signed = ... // create signed message
         *     signed.signs(0).show(function (e) {
         *         if (e) { alert(e.message); return; }
         *     })
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @param {Function} [fn] функция для обработки ошибки.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @chainable
         */
        show: function (flags, fn) {
            if (isFunction(flags)) {
                fn = flags;
                flags = 0;
            } else if (fn === undefined) {
                flags = (typeof flags === "number" ? flags : 0);
            }
            if (fn === undefined) {
                this.object.Show(flags);
            } else {
                this.object.ShowAsync(flags, this.makeAsync(fn));
            }
            return this;
        },

        /**
         * Предназначен для получения объекта версии подписи.
         * @return {Number}
         */
        version: function () {
            return parseInt(this.object.Version);
        },

        /**
         * Предназначен для получения двоичной ЭЦП (EncryptedDigest).
         * @return {avcmx.Blob}
         */
        val: function () {
            return this.factory(this.object.Sign);
        },

        /**
         * Предназначен для получения OID алгоритма хэширования.
         * @return {String}
         */
        hashAlg: function () {
            return this.object.HashAlgOid;
        },
 
        /**
         * Предназначен для получения OID алгоритма проверки ЭЦП.
         * @return {String}
         */
        signAlg: function () {
            return this.object.SignAlgOid;
        },

        /**
         * Предназначен для получения времени создания подписи.
         * @return {Date}
         */
        datetime: function () {
            return new Date(this.object.SignDateTimeSec * 1000);
        },

        /**
         * Предназначен для получения сертификата подписанта.
         * @return {avcmx.Certificate}
         */
        cert: function () {
            return this.factory(this.object.SignerCertificate);
        },

        /**
         * Предназначен для получения атрибутного сертификата подписанта из сообщения.
         * @return {avcmx.AttributeCertificates}
         * @since 1.1.4
         */
        attrCerts: function () {
            return this.factory(this.object.SignerAttributeCertificates, "AttributeCertificates");
        },

        /**
         *  Предназначен для получения количества авторизованных атрибутов.
         *  @return {Number}
         */
        authCount: function () {
            return parseInt(this.object.AuthorizedAttributesCount);
        },

        /**
         * Предназначен для получения авторизованного атрибута по индексу или по OID.
         * 
         * Получение первого атрибута
         * 
         *      signed = ... // create signed message
         *     signed.signs(0).authAttr(0)
         *     
         * Получение атрибута с OID 1.1.1.1
         * 
         *      signed = ... // create signed message
         *     signed.signs(0).authAttr("1.1.1.1")
         *     
         * @param {String|Number} oidOrIndex OID атрибута либо индекс
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.SignAttribute}
         */
        authAttr: function (oidOrIndex, flags) {
            flags = flags || 0;
            if (typeof oidOrIndex === "string" && oidOrIndex.indexOf(".") > 0) {
                return this.factory(this.object.GetAuthorizedAttributeByOid(oidOrIndex, flags), "SignAttribute");
            } else {
                return this.factory(this.object.GetAuthorizedAttributeByIndex(oidOrIndex, flags), "SignAttribute");
            }
        },

        /**
         *  Предназначен для получения количества неавторизованных атрибутов.
         *  @return {Number}
         */
        unauthCount: function () {
            return parseInt(this.object.UnauthorizedAttributesCount);
        },

        /**
         * Предназначен для получения неавторизованного атрибута по индексу или по OID.
         * 
         * Получение первого атрибута
         * 
         *      signed = ... // create signed message
         *     signed.signs(0).unauthAttr(0)
         *     
         * Получение атрибута с OID 1.1.1.1
         * 
         *      signed = ... // create signed message
         *     signed.signs(0).unauthAttr("1.1.1.1")
         *     
         * @param {String|Number} oidOrIndex OID атрибута либо индекс
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.SignAttribute}
         */
        unauthAttr: function (oidOrIndex, flags) {
            flags = flags || 0;
            if (typeof oidOrIndex === "string" && oidOrIndex.indexOf(".") > 0) {
                return this.factory(this.object.GetUnauthorizedAttributeByOid(oidOrIndex, flags), "SignAttribute");
            } else {
                return this.factory(this.object.GetUnauthorizedAttributeByIndex(oidOrIndex, flags), "SignAttribute");
            }
        }
    });

    /**
     * @class avcmx.SignAttribute
     * Предназначен для работы с атрибутами подписи, например, для получения их значений.
     * @extends avcmxobject.<native.AvCMX.SignAttribute>
     */
    avcmx.SignAttribute.prototype = extend(avcmx.SignAttribute.prototype, {
        /**
         * Предназначен для получения OID атрибута подписи.
         * @return {String}
         */
        oid: function () {
            return this.object.Oid;
        },

        /**
         * Предназначен для получения значения атрибута подписи.
         * @return {avcmx.Blob}
         */
        val: function () {
            return this.factory(this.object.Value);
        },

        /**
         * Предназначен для получения значения атрибута подписи в строковом виде.
         * @return {String}
         */
        str: function () {
            return this.object.ValueAsString;
        }
    });

    /**
     * @class avcmx.Certificates
     * Предназначен для работы с набором сертификатов X.509, например, для создания списка получателей
     * зашифрованного сообщения.
     * @extends avcmxobject.<native.AvCMX.Certificates>
     */
    avcmx.Certificates.prototype = extend(avcmx.Certificates.prototype, {
        /**
         * Предназначен для получения количества сертификатов в списке.
         * @return {Number}
         */
        length: function () {
            return parseInt(this.object.Count);
        },

        /**
         * Предназначен для получения объектов отдельных сертификатов списка для последующей обработки 
         * (например, получения их атрибутов). Индексируется целым числом от 0 до {@link avcmx.Certificates#length} – 1
         * 
         * Получение первого сертификата
         * 
         *      certs = ... // create certificates
         *     certs.certs(0)
         *     certs.certs()[0]
         *     
         * Получение всех сертификатов по индексу
         * 
         *      certs = ... // create certificates
         *     for (var i = 0; i < certs.length(); i++) {
         *         certs.certs(i)
         *     }
         *     
         * Получение всех сертификатов и перебор
         * 
         *      certs = ... // create certificates
         *      certs = certs.certs()
         *     for (var i = 0; i < certs.length; i++) {
         *         certs[i]
         *     }
         * 
         * @param {Number} [index] номер сертификата, который нужно получить (от 0).
         * @return {avcmx.Certificate|avcmx.Certificate[]} возвращает объект сертификата если передан индекс, иначе - список всех сертификатов
         */
        certs: function (index) {
            if (index === undefined) {
                if (this.certsCache === undefined) {
                    this.certsCache = [];
                    for (var i = 0; i < this.object.Count; i++) {
                        this.certsCache.push(this.factory(this.object.Item(i)));
                    }
                }
                return this.certsCache;
            } else {
                return this.certsCache ? this.certsCache[index] : this.factory(this.object.Item(index));
            }
        },

        /**
         * Предназначен для добавления отдельного сертификата или сертификатов, отобранных по списку условий, 
         * в список сертификатов.
         * 
         * @param {avcmx.Certificate|avcmx.Parameters} certOrParams сертификат или параметры отбора сертификатов
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @chainable
         */
        add: function (certOrParams, flags) {
            flags = flags || 0;
            if (certOrParams.toString().indexOf("[wrapper AvCMX.") == 0) {
                if (certOrParams.toString() == "[wrapper AvCMX.Certificate]") {
                    this.object.AddCertificate(certOrParams.get(), flags);
                } else if (certOrParams.toString() == "[wrapper AvCMX.Parameters]") {
                    this.object.AddCertificates(certOrParams.get(), flags);
                }
            } else {
                // TODO: custom params constructor
            }
            delete this.certsCache;
            return this;
        }
    });

    /**
     * @class avcmx.AttributeCertificates
     * Предназначен для работы с набором атрибутных сертификатов.
     * @extends avcmxobject.<native.AvCMX.AttributeCertificates>
     */
    avcmx.AttributeCertificates.prototype = extend(avcmx.AttributeCertificates.prototype, {
        /**
         * Предназначен для получения количества сертификатов атрибутных в списке.
         * @return {Number}
         */
        length: function () {
            return parseInt(this.object.Count);
        },

        /**
         * Предназначен для получения объектов отдельных атрибутных сертификатов списка для последующей обработки 
         * (например, получения их атрибутов). Индексируется целым числом от 0 до {@link avcmx.AttributeCertificates#length} – 1
         * 
         * Получение первого атрибутного сертификата
         * 
         *      certs = ... // create certificates
         *     certs.certs(0)
         *     certs.certs()[0]
         *     
         * Получение всех атрибутных сертификатов по индексу
         * 
         *      certs = ... // create certificates
         *     for (var i = 0; i < certs.length(); i++) {
         *         certs.certs(i)
         *     }
         *     
         * Получение всех атрибутных сертификатов и перебор
         * 
         *      certs = ... // create certificates
         *      signs = certs.certs()
         *     for (var i = 0; i < certs.length; i++) {
         *         certs[i]
         *     }
         * 
         * @param {Number} [index] номер сертификата, который нужно получить (от 0).
         * @return {avcmx.AttributeCertificate|avcmx.AttributeCertificate[]} возвращает объект атрибутного сертификата если передан индекс, иначе - список всех атрибутных сертификатов
         */
        certs: function (index) {
            if (index === undefined) {
                if (this.certsCache === undefined) {
                    this.certsCache = [];
                    for (var i = 0; i < this.object.Count; i++) {
                        this.certsCache.push(this.factory(this.object.Item(i)));
                    }
                }
                return this.certsCache;
            } else {
                return this.certsCache ? this.certsCache[index] : this.factory(this.object.Item(index));
            }
        },

        /**
         * Предназначен для добавления отдельного атрибутного сертификата или сертификатов, отобранных по списку условий, 
         * в список атрибутных сертификатов.
         * 
         * @param {avcmx.AttributeCertificate|avcmx.Parameters} certOrParams атрибутный сертификат или параметры отбора атрибутных сертификатов
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @chainable
         */
        add: function (certOrParams, flags) {
            flags = flags || 0;
            if (certOrParams.toString().indexOf("[wrapper AvCMX.") == 0) {
                if (certOrParams.toString() == "[wrapper AvCMX.AttributeCertificate]") {
                    this.object.AddCertificate(certOrParams.get(), flags);
                } else if (certOrParams.toString() == "[wrapper AvCMX.Parameters]") {
                    this.object.AddCertificates(certOrParams.get(), flags);
                }
            } else {
                // TODO: custom params constructor
            }
            delete this.certsCache;
            return this;
        }
    });

    /**
     * @class avcmx.Certificate
     * Предназначен для работы с сертификатами X.509; например, для получения 
     * свойств сертификата, либо для его отображения пользователю.
     * @extends avcmxobject.<native.AvCMX.Certificate>
     */
    avcmx.Certificate.prototype = extend(avcmx.Certificate.prototype, {
        /**
         * Предназначен для получения версии сертификата.
         * @return {Number}
         */
        version: function () {
            return parseInt(this.object.Version);
        },

        /**
         * Предназначен для получения сертификата в экспортируемом виде. Возвращает DER 
         * закодированный X.509 сертификат.
         * @return {avcmx.Blob}
         */
        val: function () {
            return this.factory(this.object.Blob);
        },

        /**
         * Предназначен для получения серийного номера сертификата.
         * @return {avcmx.Blob}
         */
        serial: function () {
            return this.factory(this.object.Serial);
        },

        /**
         * Предназначен для получения OID алгоритма выработки ЭЦП сертификата.
         * @return {String}
         */
        signAlg: function () {
            return this.object.SignAlgOid;
        },

        /**
         * Предназначен для получения времени начала действия сертификата.
         * @return {Date}
         */
        notBefore: function () {
            return new Date(this.object.ValidityNotBeforeSec * 1000);
        },

        /**
         * Предназначен для получения времени окончания действия сертификата.
         * @return {Date}
         */
        notAfter: function () {
            return new Date(this.object.ValidityNotAfterSec * 1000);
        },

        /**
         * Предназначен для получения идентификатора публичного ключа сертификата.
         * @return {avcmx.Blob}
         */
        pubKeyId: function () {
            return this.factory(this.object.PublicKeyId);
        },

        /**
         * Предназначен для получения OID алгоритма публичного ключа сертификата.
         * @return {String}
         */
        pubKeyAlg: function () {
            return this.object.PublicKeyAlgOid;
        },

        /**
         * Предназначен для получения публичного ключа сертификата.
         * @return {avcmx.Blob}
         */
        pubKey: function () {
            return this.factory(this.object.PublicKey);
        },

        /**
         * Предназначен для получения идентификатора ключа издателя сертификата.
         * @return {String}
         */
        authKeyId: function () {
            return this.object.AuthorityKeyIdentifier;
        },

        /**
         * Предназначен для получения сертификата издателя сертификата.
         * @return {avcmx.Certificate}
         */
        issuer: function () {
            return this.factory(this.object.IssuerCertificate);
        },

        /**
         * Предназначен для получения статуса сертификата.
         * @return {avcmx.CertificateStatus}
         */
        status: function () {
            return this.factory(this.object.Status);
        },

        /**
         * Предназначен для получения количества атрибутов в имени издателя.
         * @return {Number}
         */
        issuerNameCount: function () {
            return parseInt(this.object.IssuerNameAttributesCount);
        },

        /**
         * Предназначен для получения количества атрибутов в имени субъекта.
         * @return {Number}
         */
        subjectNameCount: function () {
            return parseInt(this.object.SubjectNameAttributesCount);
        },

        /**
         * Предназначен для получения количества дополнений в сертификате.
         * @return {Number}
         */
        extCount: function () {
            return parseInt(this.object.ExtensionsCount);
        },

        /**
         * Предназначен для проверки доверия к сертификату. При этом проверяется правильность подписей 
         * сертификата и цепочки его издателей вплоть до издателя, помещѐнного в справочник доверенных 
         * издателей сертификатов. Метод завершится успешно только в том случае, если доверие сертификату установлено.
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {Boolean}
         */
        valid: function (flags) {
            flags = flags || 0;
            return this.object.CheckValidity(flags) == 0;
        },

        /**
         * Предназначен для проверки возможности какого-либо расширенного использования сертификата.
         * 
         * @param {String} oid OID нужного расширенного использования.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {Boolean}
         */
        extKeyUsageAllowed: function (oid, flags) {
            flags = flags || 0;
            return this.object.IsExtKeyUsageAllowed(oid, flags);
        },

        /**
         * Предназначен для импортирования сертификата в справочник сертификатов и СОС.
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @chainable
         */
        importCert: function (flags) {
            flags = flags || 0;
            this.object.Import(flags);
            return this;
        },

        /**
         * Предназначен для отображения окна информации о сертификате.
         * 
         * <b>Примечание: при вызове без параметров данный метод отображает диалог, что "подвесит" окно браузера и 
         * оно будет недоступно. Чтобы этого не произошло необходимо передать в параметры функцию для обработки ошибки.</b>
         * 
         * Пример:
         * 
         *      cert = ... // create certificate
         *     cert.show(function (e) {
         *         if (e) { alert(e.message); return; }
         *     })
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @param {Function} [fn] функция для обработки ошибки.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @chainable
         */
        show: function (flags, fn) {
            if (isFunction(flags)) {
                fn = flags;
                flags = 0;
            } else if (fn === undefined) {
                flags = (typeof flags === "number" ? flags : 0);
            }
            if (fn === undefined) {
                this.object.Show(flags);
            } else {
                this.object.ShowAsync(flags, this.makeAsync(fn));
            }
            return this;
        },

        /**
         * Предназначен для получения дополнения сертификата по его OID или номеру (от 0 до {@link avcmx.Certificate#extCount} – 1).
         * 
         * Получение первого дополнения:
         * 
         *      cert = ... // create certificate
         *     cert.ext(0)
         *     
         * Получение дополнения с OID 1.1.1.1:
         * 
         *      cert = ... // create certificate
         *     cert.ext("1.1.1.1")
         * 
         * @param {String|Number} oidOrIndex OID или индекс получаемого дополнения.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Extension}
         */
        ext: function (oidOrIndex, flags) {
            flags = flags || 0;
            if (typeof oidOrIndex === "string" && oidOrIndex.indexOf(".") > 0) {
                return this.factory(this.object.GetExtensionByOid(oidOrIndex, flags));
            } else {
                return this.factory(this.object.GetExtensionByIndex(oidOrIndex, flags));
            }
        },

        /**
         * Предназначен для получения атрибута имени издателя сертификата по его OID или номеру. 
         * Если метод вызван без параметров будет возвращена полная строка имени издателя сертификата.
         * 
         * Получение полной строки имени издателя:
         * 
         *      cert = ... // create certificate
         *     cert.issuerName()
         *     
         * Получение первого атрибута имени издателя:
         * 
         *      cert = ... // create certificate
         *     cert.issuerName(0)
         *     
         * Получение атрибута Common Name имени издателя:
         * 
         *      cert = ... // create certificate
         *     cert.issuerName("2.5.4.3")
         * 
         * @param {String|Number} [oidOrIndex] OID или индекс получаемого атрибута.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {String|avcmx.NameAttribute}
         */
        issuerName: function (oidOrIndex, flags) {
            if (oidOrIndex === undefined) return this.object.Issuer;
            flags = flags || 0;
            if (typeof oidOrIndex === "string" && oidOrIndex.indexOf(".") > 0) {
                return this.factory(this.object.GetIssuerNameAttributeByOid(oidOrIndex, flags), "NameAttribute");
            } else {
                return this.factory(this.object.GetIssuerNameAttributeByIndex(oidOrIndex, flags), "NameAttribute");
            }
        },

        /**
         * Предназначен для получения атрибута имени субъекта сертификата по его OID или номеру. 
         * Если метод вызван без параметров будет возвращена полная строка имени субъекта сертификата.
         * 
         * Получение полной строки имени субъекта:
         * 
         *      cert = ... // create certificate
         *     cert.subjectName()
         *     
         * Получение первого атрибута имени субъекта:
         * 
         *      cert = ... // create certificate
         *     cert.subjectName(0)
         *     
         * Получение атрибута Common Name имени субъекта:
         * 
         *      cert = ... // create certificate
         *     cert.subjectName("2.5.4.3")
         *     
         * @param {String|Number} [oidOrIndex] OID или индекс получаемого атрибута.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {String|avcmx.NameAttribute}
         */
        subjectName: function (oidOrIndex, flags) {
            if (oidOrIndex === undefined) return this.object.Subject;
            flags = flags || 0;
            if (typeof oidOrIndex === "string" && oidOrIndex.indexOf(".") > 0) {
                return this.factory(this.object.GetSubjectNameAttributeByOid(oidOrIndex, flags), "NameAttribute");
            } else {
                return this.factory(this.object.GetSubjectNameAttributeByIndex(oidOrIndex, flags), "NameAttribute");
            }
        }
    });

    /**
     * @class avcmx.AttributeCertificate
     * предназначен для работы с атрибутными сертификатами
     * @extends avcmxobject.<native.AvCMX.AttributeCertificate>
     */
    avcmx.AttributeCertificate.prototype = extend(avcmx.AttributeCertificate.prototype, {
        /**
         * Предназначен для получения версии атрибутного сертификата.
         * @return {Number}
         */
        version: function () {
            return parseInt(this.object.Version);
        },

        /**
         * Предназначен для получения атрибутного сертификата в экспортируемом виде. Возвращает DER 
         * закодированный атрибутный сертификат.
         * @return {avcmx.Blob}
         */
        val: function () {
            return this.factory(this.object.Blob);
        },

        /**
         * Предназначен для получения серийного номера атрибутного сертификата.
         * @return {avcmx.Blob}
         */
        serial: function () {
            return this.factory(this.object.Serial);
        },

        /**
         * Предназначен для получения OID алгоритма выработки ЭЦП атрибутного сертификата.
         * @return {String}
         */
        signAlg: function () {
            return this.object.SignAlgOid;
        },

        /**
         * Предназначен для получения времени начала действия атрибутного сертификата.
         * @return {Date}
         */
        notBefore: function () {
            return new Date(this.object.ValidityNotBeforeSec * 1000);
        },

        /**
         * Предназначен для получения времени окончания действия атрибутного сертификата.
         * @return {Date}
         */
        notAfter: function () {
            return new Date(this.object.ValidityNotAfterSec * 1000);
        },

        /**
         * Предназначен для получения сертификата издателя атрибутного сертификата.
         * @return {avcmx.Certificate}
         */
        issuer: function () {
            return this.factory(this.object.IssuerCertificate);
        },

        /**
         * Предназначен для получения сертификата владельца атрибутного сертификата.
         * @return {avcmx.Certificate}
         */
        holder: function () {
            return this.factory(this.object.HolderCertificate);
        },

        /**
         * Предназначен для получения статуса атрибутного сертификата.
         * @return {avcmx.CertificateStatus}
         */
        status: function () {
            return this.factory(this.object.Status);
        },

        /**
         * Предназначен для получения количества атрибутов в имени издателя.
         * @return {Number}
         */
        issuerNameCount: function () {
            return parseInt(this.object.IssuerNameAttributesCount);
        },

        /**
         * Предназначен для получения количества дополнений в атрибутном сертификате.
         * @return {Number}
         */
        extCount: function () {
            return parseInt(this.object.ExtensionsCount);
        },

        /**
         * Предназначен для получения количества атрибутов в атрибутном сертификате.
         * @return {Number}
         */
        attrCount: function () {
            return parseInt(this.object.AttributesCount);
        },

        /**
         * Предназначен для проверки доверия к атрибутному сертификату. При этом проверяется правильность подписей 
         * атрибутного сертификата и цепочки его издателей вплоть до издателя, помещѐнного в справочник доверенных 
         * издателей сертификатов. Метод завершится успешно только в том случае, если доверие атрибутному сертификату установлено.
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {Boolean}
         */
        valid: function (flags) {
            flags = flags || 0;
            return this.object.CheckValidity(flags) == 0;
        },

        /**
         * Предназначен для импортирования атрибутного сертификата в справочник сертификатов и СОС.
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @chainable
         */
        importCert: function (flags) {
            flags = flags || 0;
            this.object.Import(flags);
            return this;
        },

        /**
         * Предназначен для отображения окна информации об атрибутном сертификате.
         * 
         * <b>Примечание: при вызове без параметров данный метод отображает диалог, что "подвесит" окно браузера и 
         * оно будет недоступно. Чтобы этого не произошло необходимо передать в параметры функцию для обработки ошибки.</b>
         * 
         * Пример:
         * 
         *      attrcert = ... // create attribute certificate
         *     attrcert.show(function (e) {
         *         if (e) { alert(e.message); return; }
         *     })
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @param {Function} [fn] функция для обработки ошибки.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @chainable
         */
        show: function (flags, fn) {
            if (isFunction(flags)) {
                fn = flags;
                flags = 0;
            } else if (fn === undefined) {
                flags = (typeof flags === "number" ? flags : 0);
            }
            if (fn === undefined) {
                this.object.Show(flags);
            } else {
                this.object.ShowAsync(flags, this.makeAsync(fn));
            }
            return this;
        },

        /**
         * Предназначен для получения дополнения атрибутного сертификата по его OID или номеру (от 0 до {@link avcmx.AttributeCertificate#extCount} – 1).
         * 
         * Получение первого дополнения:
         * 
         *      attrcert = ... // create attribute certificate
         *     attrcert.ext(0)
         *     
         * Получение дополнения с OID 1.1.1.1:
         * 
         *      attrcert = ... // create attribute certificate
         *     attrcert.ext("1.1.1.1")
         * 
         * @param {String|Number} oidOrIndex OID или индекс получаемого дополнения.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Extension}
         */
        ext: function (oidOrIndex, flags) {
            flags = flags || 0;
            if (typeof oidOrIndex === "string" && oidOrIndex.indexOf(".") > 0) {
                return this.factory(this.object.GetExtensionByOid(oidOrIndex, flags));
            } else {
                return this.factory(this.object.GetExtensionByIndex(oidOrIndex, flags));
            }
        },

        /**
         * Предназначен для получения атрибута атрибутного сертификата по его OID или номеру (от 0 до {@link avcmx.AttributeCertificate#attrCount} – 1).
         * 
         * Получение первого атрибута:
         * 
         *      attrcert = ... // create attribute certificate
         *     attrcert.attr(0)
         *     
         * Получение атрибута с OID 1.1.1.1:
         * 
         *      attrcert = ... // create attribute certificate
         *     attrcert.attr("1.1.1.1")
         * 
         * @param {String|Number} oidOrIndex OID или индекс получаемого атрибута.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {avcmx.Attribute}
         */
       attr: function (oidOrIndex, flags) {
            flags = flags || 0;
            if (typeof oidOrIndex === "string" && oidOrIndex.indexOf(".") > 0) {
                return this.factory(this.object.GetAttributeByOid(oidOrIndex, flags), "Attribute");
            } else {
                return this.factory(this.object.GetAttributeByIndex(oidOrIndex, flags), "Attribute");
            }
        },

        /**
         * Предназначен для получения атрибута имени издателя атрибутного сертификата по его OID или номеру. 
         * Если метод вызван без параметров будет возвращена полная строка имени издателя атрибутного сертификата.
         * 
         * Получение полной строки имени издателя:
         * 
         *      attrcert = ... // create attribute certificate
         *     attrcert.issuerName()
         *     
         * Получение первого атрибута имени издателя:
         * 
         *      attrcert = ... // create attribute certificate
         *     attrcert.issuerName(0)
         *     
         * Получение атрибута Common Name имени издателя:
         * 
         *      attrcert = ... // create attribute certificate
         *     attrcert.issuerName("2.5.4.3")
         * 
         * @param {String|Number} [oidOrIndex] OID или индекс получаемого атрибута.
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {String|avcmx.NameAttribute}
         */
        issuerName: function (oidOrIndex, flags) {
            if (oidOrIndex === undefined) return this.object.Issuer;
            flags = flags || 0;
            if (typeof oidOrIndex === "string" && oidOrIndex.indexOf(".") > 0) {
                return this.factory(this.object.GetIssuerNameAttributeByOid(oidOrIndex, flags), "NameAttribute");
            } else {
                return this.factory(this.object.GetIssuerNameAttributeByIndex(oidOrIndex, flags), "NameAttribute");
            }
        }
    });

    /**
     * @class avcmx.CertificateStatus
     * Предназначен для работы со статусом сертификата, например, причиной его отзыва.
     * @extends avcmxobject.<native.AvCMX.CertificateStatus>
     */
    avcmx.CertificateStatus.prototype = extend(avcmx.CertificateStatus.prototype, {
        /**
         * Предназначен для получения признака действительности сертификата.
         * @return {Boolean}
         */
        trusted: function () {
            return this.object.IsTrusted;
        },

        /**
         * Предназначен для получения даты отзыва сертификата. Если сертификат не отозван, будет возвращено <b>null</b>.
         * @return {Date|null}
         */
        revTime: function () {
            try{
                return new Date(this.object.RevocationTimeSec * 1000);
            } catch (e) {
                if (AvCMXError.lastErrorIs(avcmx.constants.AVCMR_BAD_HANDLE)) {
                    return null;
                } else {
                    throw e;
                }
            }
        },

        /**
         * Предназначен для получения причины отзыва сертификата. Если сертификат не отозван, будет возвращено <b>null</b>.
         * В случае, если причина отзыва сертификата не указана, в качестве причины возвращается 0 (unspecified).
         * @return {Number|null}
         */
        revReason: function () {
            try {
                return parseInt(this.object.RevocationReason);
            } catch (e) {
                if (AvCMXError.lastErrorIs(avcmx.constants.AVCMR_BAD_HANDLE)) {
                    return null;
                } else {
                    throw e;
                }
            }
        },

        /**
         * Предназначен для получения причины недоверия сертификату. Если сертификат не отозван, будет возвращено <b>null</b>.
         * 
         * На данный момент поддерживаются следующие причины недоверия сертификату:
         * 
         * - <b>AVCM_CSR_REVOKED</b> – сертификат отозван.
         * - <b>AVCM_CSR_UNKNOWN</b> – причина недоверия не может быть установлена
         * 
         * @return {Number|null}
         */
        untrustReason: function () {
            try {
                return parseInt(this.object.UntrustReason);
            } catch (e) {
                if (AvCMXError.lastErrorIs(avcmx.constants.AVCMR_BAD_HANDLE)) {
                    return null;
                } else {
                    throw e;
                }
            }
        }
    });

    /**
     * @class avcmx.CRL
     * Предназначен для работы с СОС X.509, например, для получения свойств СОС.
     * @extends avcmxobject.<native.AvCMX.CRL>
     */
    avcmx.CRL.prototype = extend(avcmx.CRL.prototype, {
        /**
         * Предназначен для получения СОС в экспортируемом виде. Свойство возвращает DER закодированный X.509 СОС.
         * @return {avcmx.Blob}
         */
        val: function () {
            return this.factory(this.object.Blob);
        },

        /**
         * Предназначен для получения атрибутов списка отозванных сертификатов.
         * 
         * На данный момент поддерживаются следующие идентификаторы атрибутов (в скобках указан тип данных в блобе):
         * 
         * - <b>AVCM_VERSION</b> – версия списка отозванных сертификатов (число).
         * - <b>AVCM_ISSUER_AS_STRING</b> – имя (X.509 Name) издателя списка отозванных сертификатов в виде строки, 
         * в том случае, если это поле СОС можно представить в виде строки. Если атрибут невозможно представить в виде 
         * строки ASCIIZ, будет возвращена ошибка <b>AVCMR_BAD_FORMAT</b> (строка с нулевым байтом в конце).
         * - <b>AVCM_THIS_UPDATE</b> – дата/время издания списка отозванных сертификатов (дата).
         * - <b>AVCM_NEXT_UPDATE</b> – дата/время окончания действия списка отозванных сертификатов (дата).
         * - <b>AVCM_PUB_KEY_ID</b> – идентификатор открытого ключа сертификата издателя СОС (строка с нулевым байтом в конце).
         * - <b>AVCM_SIGN_ALG_OID</b> – идентификатор алгоритма ЭЦП (строка с нулевым байтом в конце).
         * - <b>AVCM_BLOB</b> – DER-представление списка отозванных сертификатов (бинарные данные). Аналогично вызову {@link avcmx.CRL#val}
         * - <b>AVCM_SHA1_HASH</b> – SHA-1 хэш от DER-представление списка отозванных сертификатов (бинарные данные).
         * 
         * @param {Number} id идентификатор получаемого атрибута
         * @return {avcmx.Blob}
         */
        attr: function (id) {
            return this.factory(this.object.GetAttribute(id));
        }
    });

    /**
     * @class avcmx.Requests
     * Предназначен для работы с набором запросов на сертификаты.
     * @extends avcmxobject.<native.AvCMX.Requests>
     * @since 1.1.1
     */
    avcmx.Requests.prototype = extend(avcmx.Requests.prototype, {
        /**
         * Предназначен для получения количества запросов в списке.
         * @return {Number}
         */
        length: function () {
            return parseInt(this.object.Count);
        },

        /**
         * Предназначен для получения объектов запросов списка для последующей обработки 
         * (например, получения их атрибутов). Индексируется целым числом от 0 до {@link avcmx.Requests#length} – 1
         * 
         * Получение первого запроса
         * 
         *      reqs = ... // create requests
         *     reqs.reqs(0)
         *     reqs.reqs()[0]
         *     
         * Получение всех запросов по индексу
         * 
         *      reqs = ... // create requests
         *     for (var i = 0; i < reqs.length(); i++) {
         *         reqs.reqs(i)
         *     }
         *     
         * Получение всех запросов и перебор
         * 
         *      reqs = ... // create requests
         *      reqs = reqs.reqs()
         *     for (var i = 0; i < reqs.length; i++) {
         *         reqs[i]
         *     }
         * 
         * @param {Number} [index] номер запроса, который нужно получить (от 0).
         * @return {avcmx.Request|avcmx.Request[]} возвращает объект запрос если передан индекс, иначе - список всех запросов
         */
        reqs: function (index) {
            if (index === undefined) {
                if (this.reqsCache === undefined) {
                    this.reqsCache = [];
                    for (var i = 0; i < this.object.Count; i++) {
                        this.reqsCache.push(this.factory(this.object.Item(i)));
                    }
                }
                return this.reqsCache;
            } else {
                return this.reqsCache ? this.reqsCache[index] : this.factory(this.object.Item(index));
            }
        },

        /**
         * Предназначен для добавления запроса или запросов, отобранных по списку условий, 
         * в список запросов.
         * 
         * @param {avcmx.Request|avcmx.Parameters} reqOrParams запрос или параметры отбора сертификатов
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @chainable
         */
        add: function (reqOrParams, flags) {
            flags = flags || 0;
            if (reqOrParams.toString().indexOf("[wrapper AvCMX.") == 0) {
                if (reqOrParams.toString() == "[wrapper AvCMX.Request]") {
                    this.object.AddRequest(reqOrParams.get(), flags);
                } else if (reqOrParams.toString() == "[wrapper AvCMX.Parameters]") {
                    // not implemented
                    this.object.AddRequests(reqOrParams.get(), flags);
                }
            } else {
                // TODO: custom params constructor
            }
            delete this.reqsCache;
            return this;
        }
    });

    /**
     * @class avcmx.Request
     * Предназначен для работы с запросом PKCS#10, например, для получения свойств запроса.
     * @extends avcmxobject.<native.AvCMX.Request>
     */
    avcmx.Request.prototype = extend(avcmx.Request.prototype, {
        /**
         * Предназначен для получения запроса в экспортируемом виде. Возвращает DER закодированный PKCS#10 запрос.
         * @return {avcmx.Blob}
         */
        val: function () {
            return this.factory(this.object.Blob);
        },

        /**
         * Предназначен для получения идентификатора публичного ключа запроса.
         * @return {avcmx.Blob}
         */
        pubKeyId: function () {
            return this.factory(this.object.PublicKeyId);
        },

        /**
         * Предназначен для проверки совместимости запроса с Центром Сертификатов Microsoft.
         * @return {Boolean}
         */
        mscaCompatible: function () {
            return this.object.MSCACompatible;
        },

        /**
         * Предназначен для получения имени контейнера соответствующего данному запросу.
         * @return {String|null}
         */
        container: function () {
            try {
                return this.object.ContainerName;
            } catch (e) {
                if (AvCMXError.lastErrorIs(avcmx.constants.AVCMR_NOT_FOUND)) {
                    return null;
                } else {
                    throw e;
                }
            }
        },

        /**
         * Предназначен для получения адреса SCEP сервера, на который был отправлен данный запрос.
         * @return {String|null}
         */
        scepUrl: function () {
            try {
                return this.object.SCEPURL;
            } catch (e) {
                if (AvCMXError.lastErrorIs(avcmx.constants.AVCMR_NOT_FOUND)) {
                    return null;
                } else {
                    throw e;
                }
            }
        },

        /**
         * Предназначен для получения статуса запроса.
         * 
         * На данный момент поддерживаются следующие статусы:
         *
         * - <b>AVCM_REQUEST_STATE_INBOX</b> – во входной очереди.
         * - <b>AVCM_REQUEST_STATE_PROCESSED</b> – обработан.
         * - <b>AVCM_REQUEST_STATE_REJECTED</b> – отказано в выдаче сертификата.
         * - <b>AVCM_REQUEST_STATE_MANUALPROCESSING</b> – переведен в ручную обработку.
         * - <b>AVCM_REQUEST_STATE_SIGN_WAIT</b> – ожидание второй подписи.
         * - <b>AVCM_REQUEST_STATE_PENDING</b> – ожидание обработки сервером SCEP.
         * 
         * @return {Number}
         */
        state: function () {
            return this.object.State;
        },

        /**
         * Предназначен для получения даты генерации запроса.
         * @return {Date|null}
         */
        datetime: function () {
            try {
                return new Date(this.object.SignDateTimeSec * 1000);
            } catch (e) {
                if (AvCMXError.lastErrorIs(avcmx.constants.AVCMR_NOT_FOUND)) {
                    return null;
                } else {
                    throw e;
                }
            }
        }
    });

    /**
     * @class avcmx.Extension
     * Предназначен для работы с дополнениями сертифиатов, например, для получения их значений.
     * @extends avcmxobject.<native.AvCMX.Extension>
     */
    avcmx.Extension.prototype = extend(avcmx.Extension.prototype, {
        /**
         * Предназначен для получения OID дополнения.
         * @return {String}
         */
        oid: function () {
            return this.object.Oid;
        },

        /**
         * Предназначен для получения зарегистрированного названия OID дополнения. Если OID не 
         * зарегистрирован в системе, будет возвращена ошибка.
         * @return {String}
         */
        oidName: function () {
            return this.object.OidName;
        },

        /**
         * Предназначен для проверки флага критичности дополнения.
         * @return {Boolean}
         */
        crit: function () {
            return this.object.Critical;
        },

        /**
         * Предназначен для получения полного значения (blob) дополнения. Возвращается полный блок данных, 
         * являющийся значением дополнения, в т.ч. с ASN.1 кодом типа содержащихся данных.
         * @return {avcmx.Blob}
         */
        val: function () {
            return this.factory(this.object.Value);
        },

        /**
         * Предназначен для получения значения дополнения в строковом виде.
         * @return {String|null}
         */
        str: function () {
            try {
                return this.object.ValueAsString;
            } catch (e) {
                if (AvCMXError.lastErrorIs(avcmx.constants.AVCMR_BAD_FORMAT)) {
                    return null;
                } else {
                    throw e;
                }
            }
        }
    });

    /**
     * @class avcmx.Attribute
     * предназначен для работы с атрибутами, например, для получения их значений
     * @extends avcmxobject.<native.AvCMX.Attribute>
     */
    avcmx.Attribute.prototype = extend(avcmx.Attribute.prototype, {
        /**
         * Предназначен для получения OID атрибута
         * @return {String}
         */
        oid: function () {
            return this.object.Oid;
        },

        /**
         * Предназначен для получения зарегистрированного названия OID атрибута. Если OID не 
         * зарегистрирован в системе, будет возвращена ошибка.
         * @return {String}
         */
        oidName: function () {
            return this.object.OidName;
        },

        /**
         * Предназначен для получения полного значения (blob) атрибута.
         * Возвращается полный блок данных, являющийся значением атрибута, в т.ч. с ASN.1 кодом типа содержащихся данных
         * @return {avcmx.Blob}
         */
        val: function () {
            return this.factory(this.object.Value);
        },

        /**
         * Предназначен для получения значения атрибута в тех случаях, в которых оно является строкой.
         * Если значение атрибута представляет из себя только строку, то это свойство вернѐт содержимое 
         * этой строки (без ASN.1 кодов типа и длины строки). В противном случае оно вернѐт <b>null</b>
         * @return {String|null}
         */
        str: function () {
            try {
                return this.object.ValueAsString;
            } catch (e) {
                if (AvCMXError.lastErrorIs(avcmx.constants.AVCMR_BAD_FORMAT)) {
                    return null;
                } else {
                    throw e;
                }
            }
        }
    });

    /**
     * @class avcmx.NameAttribute
     * Предназначен для работы с атрибутами имѐн сертификатов, запросов, например, для получения их значений.
     * @extends avcmxobject.<native.AvCMX.NameAttribute>
     */
    avcmx.NameAttribute.prototype = extend(avcmx.NameAttribute.prototype, {
        /**
         * Предназначен для получения OID атрибута имени
         * @return {String}
         */
        oid: function () {
            return this.object.Oid;
        },

        /**
         * Предназначен для получения строкового значения атрибута имени.
         * @return {String}
         */
        val: function () {
            return this.object.Value;
        }
    });

    /**
     * @class avcmx.Scep
     * Предназначен для работы с протоколом SCEP, например, для отправки запроса на сертификат на сервер для
     * обработки и получения цепочки сертификатов.
     * 
     * Последовательность вызовов
     * 
     * - создание {@link avcmx.Connection#scep}
     * - установка запроса на сертификат {@link avcmx.Scep#req} и имени контейнера {@link avcmx.Scep#container}
     * - подготовка к отправке {@link avcmx.Scep#prepareAsync}
     * - отправка запроса и получение ответа {@link avcmx.Scep#enrollAsync}
     * - получение цепочки с новым сертификатом {@link avcmx.Scep#resp}
     * 
     * Последовательность вызовов (offline)
     * 
     * - создание {@link avcmx.Connection#scep} с флагом <b>AVCMF_SCEP_OFFLINE</b>
     * - установка запроса на сертификат {@link avcmx.Scep#req} и имени контейнера {@link avcmx.Scep#container}
     * - получение цепочки сертификатов от сервера и установка {@link avcmx.Scep#caCert}
     * - подготовка к отправке {@link avcmx.Scep#prepareAsync}
     * - получение запроса {@link avcmx.Scep#pkiOperation} и отправка на сервер
     * - получение ответа от сервера и установка {@link avcmx.Scep#pkiOperation}
     * - разбор ответа {@link avcmx.Scep#enrollAsync}
     * - получение цепочки с новым сертификатом {@link avcmx.Scep#resp}
     * 
     * @extends avcmxobject.<native.AvCMX.Scep>
     */
    avcmx.Scep.prototype = extend(avcmx.Scep.prototype, {
        /**
         * Предназначен для установки содержимого запроса на сертификат для отправки на сервер SCEP. 
         * Установка данного свойства не обязательна, если с данного ПК ранее уже был послан запрос на сервер, 
         * то можно использовать свойство {@link avcmx.Scep#transId}.
         * 
         * @param {avcmx.Blob} blob запрос в DER-кодировке.
         * @chainable
         */
        req: function (blob) {
            if (blob) {
                this.object.Request = blob.get();
                return this;
            } else {
                return this.factory(this.object.Request);
            }
        },

        /**
         * Предназначен для получения ответа от сервера SCEP. Если сертификат не был выдан, произойдет ошибка.
         * @return {avcmx.Blob}
         */
        resp: function () {
            return this.factory(this.object.Response);
        },

        /**
         * Предназначен для установки и получения идентификатора транзакции. Получение данного свойства становится 
         * возможным только после вызова метода {@link avcmx.Scep#enroll} {@link avcmx.Scep#enrollAsync}.
         * 
         * @param {String} [val] идентификатор транзакции.
         * @return {String|avcmx.Scep} при получении возвращает идентификатор транзакции, а при устаноке - текущий объект.
         */
        transId: function (val) {
            if (val) {
                this.object.TransactionId = val;
                return this;
            } else {
                return this.object.TransactionId;
            }
        },

        /**
         * Предназначен для установки имени контейнера для связи с личным ключом.
         * 
         * @param {String} val имя контейнера
         * @chainable
         */
        container: function (val) {
            this.object.ContainerName = val;
            return this;
        },

        /**
         * Предназначен для отправки запроса на сервер, получения и разбора ответа.
         * Если в выдаче сертификата отказано, то будет сгенерирована ошибка <b>AVCMR_SCEP_ERROR</b>.
         * 
         * <b>Примечание: данный метод отправляет запрос на сервер и ожидает ответа, что "подвесит" окно браузера и 
         * оно будет недоступно. Рекомендуется использовать асинхронный аналог {@link avcmx.Scep#enrollAsync}</b>
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @return {Boolean} true если сертификат выдан, false если запрос в ожидании обработки.
         * @deprecated 1.1.1 Заменен на {@link avcmx.Scep#enrollAsync}
         */
        enroll: function (flags) {
            flags = flags || 0;
            return this.object.Enroll(flags);
        },

        /**
         * Предназначен для отправки запроса на сервер, получения и разбора ответа.
         * Если в выдаче сертификата отказано, то будет сгенерирована ошибка <b>AVCMR_SCEP_ERROR</b>.
         * 
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @param {Function} fn функция для обработки результата или ошибки.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @param {Boolean} fn.res true если сертификат выдан, false если запрос в ожидании обработки.
         * @chainable
         * @since 1.1.1
         */
        enrollAsync: function (flags, fn) {
            if (isFunction(flags)) {
                fn = flags;
                flags = 0;
            }
            this.object.EnrollAsync(flags, this.makeAsync(fn));
            return this;
        },

        /**
         * Предназначен для подготовки запроса для отправки на сервер SCEP.
         * 
         * <b>Примечание: данный метод может отображать диалоги, что "подвесит" окно браузера и 
         * оно будет недоступно. Рекомендуется использовать асинхронный аналог {@link avcmx.Scep#prepareAsync}</b>
         *
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @chainable
         * @deprecated 1.1.1 Заменен на {@link avcmx.Scep#prepareAsync}
         */
        prepare: function (flags) {
            flags = flags || 0;
            this.object.Prepare(flags);
            return this;
        },

        /**
         * Предназначен для подготовки запроса для отправки на сервер SCEP.
         *
         * @param {Number} [flags] флаги. На данный момент нет поддерживаемых флагов.
         * @param {Function} fn функция для обработки результата или ошибки.
         * @param {AvCMXError} fn.e объект ошибки, либо undefined при успешном выполнении.
         * @chainable
         * @since 1.1.1
         */
        prepareAsync: function (flags, fn) {
            if (isFunction(flags)) {
                fn = flags;
                flags = 0;
            }
            this.object.PrepareAsync(flags, this.makeAsync(fn));
            return this;
        },

        /**
         * Предназначен для установки цепочки сертификатов полученной от сервера SCEP. Данный метод необходимо вызывать 
         * в том случае, если при создании контекста был использован флаг <b>AVCMF_SCEP_OFFLINE</b>.
         * 
         * @param {avcmx.Blob} blob сертификаты в кодировке DER.
         * @chainable
         */
        caCert: function (blob) {
            this.object.CACert = blob.get();
            return this;
        },

        /**
         * Предназначен для установки ответа полученного от сервера SCEP или получения запроса для отправки на сервер. 
         * Данный метод необходимо вызывать в том случае, если при создании контекста был использован флаг <b>AVCMF_SCEP_OFFLINE</b>.
         * 
         * <b>Примечание: при получении данные в блобе будут закодированы в Base64, т.е. для получения содержимого необходимо 
         * воспользоваться методом {@link avcmx.Blob#text}.</b> 
         * 
         * @param {avcmx.Blob} [val] ответ от сервера в кодировке DER
         * @return {avcmx.Blob|avcmx.Scep} при установке возвращает текущий объект, а при получении - запрос для отправки на сервер.
         */
        pkiOperation: function (val) {
            if (val) {
                this.object.PKIOperation = val.get();
                return this;
            } else {
                return this.factory(this.object.PKIOperation);
            }
        }
    });

    // list of all constants (see AvCryptMail.h and AvCryptMailBase.h)
    avcmx.constants = {
        // Params
        AVCM_ATTRIBUTE_CERTS: 0x323,
        AVCM_MY_CERT: 0x8,
        AVCM_CHILDREN_COUNT: 0x9,
        AVCM_FORMAT: 0xA,
        AVCM_MF_RAW_DATA: 0x103,
        AVCM_MF_NONE: 0x104,
        AVCM_MF_SIGNED_DATA: 0x105,
        AVCM_MF_ENVELOPED_DATA: 0x106,
        AVCM_SIGN_COUNT: 0x107,
        AVCM_INNER_FORMAT: 0x108,
        AVCM_SUBJECT_ATTR_COUNT: 0x1,
        AVCM_ISSUER_ATTR_COUNT: 0x2,
        AVCM_SUBJECT_ATTR_OID: 0x1033,
        AVCM_ISSUER_ATTR_OID: 0x1034,
        AVCM_EXT_BLOB: 0x5,
        AVCM_ATTR_BLOB: 0x325,
        AVCM_AUTH_OID: 0x1040,
        AVCM_UNAUTH_OID: 0x1041,
        AVCM_AUTH_BLOB: 0x8,
        AVCM_UNAUTH_BLOB: 0x9,
        AVCM_VERSION: 0xB,
        AVCM_HASH_ALG_OID: 0x1010,
        AVCM_SIGN_ALG_OID: 0x1011,
        AVCM_SIGN: 0x12,
        AVCM_SIGN_DATE_TIME: 0x13,
        AVCM_AUTH_COUNT: 0x14,
        AVCM_UNAUTH_COUNT: 0x15,
        AVCM_AUTH_AS_STRING: 0x1016,
        AVCM_UNAUTH_AS_STRING: 0x1017,
        AVCM_VALID: 0x2C,
        AVCM_BLOB: 0x2D,
        AVCM_MSCA_COMPATIBLE: 0x30,
        AVCM_PUB_KEY_ALG_OID: 0x101E,
        AVCM_EXT_COUNT: 0x21,
        AVCM_EXT_OID: 0x1022,
        AVCM_EXT_OID_NAME: 0x1026,
        AVCM_EXT_CRITICAL: 0x23,
        AVCM_EXT_KEY_USAGE_COUNT: 0x28,
        AVCM_EXT_KEY_USAGE_NAME: 0x1028,
        AVCM_ATTR_COUNT: 0x324,
        AVCM_ATTR_OID: 0x1042,
        AVCM_ATTR_OID_NAME: 0x1044,
        AVCM_SHORT_STRING: 0x1,
        AVCM_DESCRIPTION: 0x2,
        AVCM_ERROR_CODE: 0x3,
        AVCM_RESULT_HANDLE: 0x2,
        AVCM_CERTIFICATE: 0x1,
        AVCM_CRL: 0x2,
        AVCM_PKCS10_REQUEST: 0x4,
        AVCM_PKCS7_REQUEST: 0x5,
        AVCM_PKCS7_CHAIN: 0x8,
        AVCM_STORES: 0xC9,
        AVCM_THIS_UPDATE: 0x1A,
        AVCM_NEXT_UPDATE: 0x1B,
        AVCM_SHA1_HASH: 0x2E,
        AVCM_CERT_SHA1_COMPAT: 0x1039,
        AVCM_CS_REVOCATION_TIME: 0x301,
        AVCM_CS_REVOCATION_REASON: 0x302,
        AVCM_CS_UNTRUST_REASON: 0x303,
        AVCM_CHECK_MODE: 0x401,
        AVCM_CM_OFFLINE: 0x402,
        AVCM_CM_ONLINE: 0x403,
        AVCM_RESPONDER_URL: 0x404,
        AVCM_CRL_DISTRIBUTION_POINTS: 0x1035,
        AVCM_IMPORT_PATH: 0x1036,
        AVCM_EXPORT_PATH: 0x1037,
        AVCM_OPERATION_REPORT: 0x1038,
        AVCM_CERT_PROLONGATION: 0x405,
        AVCM_ANY_FILE: 0x406,
        AVCM_OCSP_STATUS: 0x311,
        AVCM_OCSP_THIS_UPDATE: 0x312,
        AVCM_OCSP_NEXT_UPDATE: 0x313,
        AVCM_OCSP_REV_TIME: 0x314,
        AVCM_OCSP_REV_REASON_AS_DWORD: 0x315,
        AVCM_OCSP_RESPONSE_CERT: 0x316,
        AVCM_OCSP_SIGN_RESPONSE_COUNT: 0x321,
        AVCM_OCSP_SIGN_RESPONSE_BYNUM: 0x322,
        AVCM_CONST_BASE: 0xDA370100,
        AVCM_OCSP_STATUS_GOOD: 0x1 + 0xDA370100,
        AVCM_OCSP_STATUS_REVOKED: 0x2 + 0xDA370100,
        AVCM_OCSP_STATUS_UNKNOWN: 0x3 + 0xDA370100,
        AVCM_OCSP_STATUS_BAD: 0x4 + 0xDA370100,
        AVCM_CONTAINERCOUNT: 0x326,
        AVCM_SCEP_REQUEST: 0x327,
        AVCM_SCEP_PKCS_REQ: 0x328,
        AVCM_CONTAINERNAME: 0x1045,
        AVCM_SCEP_TRANSACTIONID: 0x1046,
        AVCM_MSG_INI: 0x1047,
        AVCM_DB_TYPE: 0x1,
        AVCM_DBT_MS_REGISTRY: 0x100,
        AVCM_DBT_ORACLE: 0x101,
        AVCM_DBT_SYBASE: 0x102,
        AVCM_DBT_FILE: 0x103,
        AVCM_DBT_ARCHIVE_FILE: 0x104,
        AVCM_DBT_ARCHIVE_MEMORY: 0x105,
        AVCM_DBT_E_MEMORY: 0x107,
        AVCM_SLOTID: 0x10A,
        AVCM_DB_HANDLE: 0x2,
        AVCM_DB_DSN: 0x3,
        AVCM_DB_UID: 0x4,
        AVCM_DB_PWD: 0x5,
        AVCM_DB_MS_NAME: 0x6,
        AVCM_DB_MS_ROOT_NAME: 0x7,
        AVCM_DB_CONNECTSTR: 0x4,
        AVCM_DB_FILE_PATH: 0x3,
        AVCM_DB_ARCHIVE_FILE_PATH: 0x3,
        AVCM_DB_ARCHIVE_PTR: 0x6,
        AVCM_DB_ARCHIVE_SIZE: 0x7,
        AVCM_PASSWORD: 0x1030,
        AVCM_COMMON_NAME: 0x1031,
        AVCM_ISSUER_AS_STRING: 0x100D,
        AVCM_SERIAL_AS_STRING: 0x100E,
        AVCM_PUB_KEY_ID: 0x100F,
        AVCM_SERIAL_AS_INTEGER: 0x18,
        AVCM_NOT_BEFORE: 0x1A,
        AVCM_NOT_AFTER: 0x1B,
        AVCM_KEY_NOT_BEFORE: 0x2A,
        AVCM_KEY_NOT_AFTER: 0x2B,
        AVCM_D_GREATER: 0x110,
        AVCM_D_LESS: 0x111,
        AVCM_SUBJECT_AS_STRING: 0x101C,
        AVCM_SUBJECT_ATTR: 0x101D,
        AVCM_PUB_KEY: 0x1F,
        AVCM_SUBJ_ALT_NAME_ATTR: 0x1020,
        AVCM_EXT_AS_STRING: 0x1024,
        AVCM_ATTR_AS_STRING: 0x1043,
        AVCM_PURPOSE: 0x25,
        AVCM_P_SIGN: 0x01,
        AVCM_P_CRYPT: 0x02,
        AVCM_P_NON_REPUDIABLE: 0x04,
        AVCM_TYPE: 0x26,
        AVCM_TYPE_MY: 0x10E,
        AVCM_TYPE_ROOT: 0x10F,
        AVCM_ISSUER_ATTR: 0x1032,
        AVCM_EXT_KEY_USAGE_OID: 0x1027,
        AVCM_CERT_ISSUERS_CHAIN: 0x1029,
        AVCM_PUB_KEY_ALG_PARAMS: 0x31,
        AVCM_CRL_ISSUER_SUBJECT: 0x1,
        AVCM_CRL_ISSUER_CERT: 0x2,
        AVCM_TEMPLATE: 0x2F,
        AVCM_TEMPLATE_DATA: 0x331,
        AVCM_CARDS_DATA: 0x332,
        AVCM_SCEP_CACERT: 0x333,
        AVCM_SCEP_PKIOPERATION: 0x334,
        AVCM_SCEP_PKCS_REQ_PREPARE: 0x335,
        AVCM_SCEP_PKCS_REQ_ENROLL: 0x336,
        AVCM_REQUEST_STATE: 0x337,
        AVCM_SCEP_GET_CERT_INITIAL: 0x329,
        AVCM_SCEP_LOGIN: 0x330,
        AVCM_SCEP_URL: 0x1048,
        AVCM_CSR_BASE: 0x077B1000,
        AVCM_CSR_REVOKED: 0x01 + 0x077B1000,
        AVCM_CSR_UNKNOWN: 0x02 + 0x077B1000,
        AVCM_REQUEST_STATE_INBOX: 0x1,
        AVCM_REQUEST_STATE_PROCESSED: 0x2,
        AVCM_REQUEST_STATE_REJECTED: 0x3,
        AVCM_REQUEST_STATE_MANUALPROCESSING: 0x4,
        AVCM_REQUEST_STATE_SIGN_WAIT: 0x5,
        AVCM_REQUEST_STATE_PENDING: 0x6,
        AVCM_POLICYINFO_COUNT: 0x338,
        AVCM_POLICYINFO_OID: 0x1049,
        AVCM_VIEW_SIGN_ATTR: 0x339,
        AVCM_LDAP_PATH: 0x1050,
        AVCM_BASE_SERIAL_AS_STRING: 0x1051,
        AVCM_BASE_ISSUER_AS_STRING: 0x1052,
        // Flags
        AVCMF_CHECK_FILES_INTEGRITY: 0x4,
        AVCMF_IN_RAW_DATA: 0x100,
        AVCMF_IN_PKCS7: 0x200,
        AVCMF_MESSAGE: 0x1000,
        AVCMF_OUT_PKCS7: 0x2000,
        AVCMF_ATTR_BY_NUM: 0x400000,
        AVCMF_ATTR_BY_OID: 0x800000,
        AVCMF_NEXT: 0x40,
        AVCMF_START: 0x80,
        AVCMF_ALLOC: 0x1000000,
        AVCMF_APPEND: 0x4000000,
        AVCMF_RETURN_HANDLE_IF_EXISTS: 0x1,
        AVCMF_NO_OUTPUT: 0x200000,
        AVCMF_IMPORT: 0x10,
        AVCMF_SELECT_MY_CERT: 0x2,
        AVCMF_THREAD_ERROR: 0x08,
        AVCMF_NO_CRL_VERIFY: 0x20,
        AVCMF_ALL_CERT: 0x8000,
        AVCMF_ADD_ALL_CERT: 0x80000,
        AVCMF_ADD_SIGN_CERT: 0x100000,
        AVCMF_ADD: 0x40000,
        AVCMF_DETACHED: 0x2000000,
        AVCMF_STARTUP: 0x1,
        AVCMF_SHUTDOWN: 0x2,
        AVCMF_NO_AUTH: 0x4,
        AVCMF_FORCE_TOKEN_CONTROL: 0x10000,
        AVCMF_DENY_TOKEN_CONTROL: 0x20000,
        AVCMF_IGNORE_CRL_ABSENCE: 0x1,
        AVCMF_IGNORE_CRL_EXPIRE: 0x8,
        AVCMF_REQUEST_RESULT: 0x1,
        AVCMF_ONLY_ENCR_CERTS: 0x400,
        AVCMF_REPEAT_AUTHENTICATION: 0x800,
        AVCMF_IMPORT_ALL_CERTS: 0x80000,
        AVCMF_IMPORT_CRL: 0x40000,
        AVCMF_NO_CERT_VERIFY: 0x8000000,
        AVCMF_VERIFY_ON_SIGN_DATE: 0x1,
        AVCMF_IGNORE_BAD_CERTS: 0x20,
        AVCMF_ALLOW_TO_SELECT_FILE: 0x8,
        AVCMF_RAW_SIGN: 0x40000,
        AVCMF_UPDATE_HASHVALUE: 0x40000000,
        AVCMF_UPDATE_FINAL: 0x80000000,
        AVCMF_OPEN_FOR_SIGN: 0x1000,
        AVCMF_OPEN_FOR_VERIFYSIGN: 0x2000,
        AVCMF_OPEN_FOR_ENCRYPT: 0x4000,
        AVCMF_OPEN_FOR_DECRYPT: 0x8000,
        AVCMF_UNICODE: 0x10000000,
        AVCMF_SCEP_OFFLINE: 0x1,
        // AVCMX flags
        AVCMXF_ZT_STRING: 1,
        AVCMXF_UCS2_STRING: 2,
        AVCMXF_UTF8_STRING: 4,
        // Return codes
        AVCMR_SUCCESS: 0,
        AVCMR_BASE: 0xE82A0100,
        AVCMR_ALLOC_ERROR: 0x01 + 0xE82A0100,
        AVCMR_BAD_ATTR: 0x02 + 0xE82A0100,
        AVCMR_BAD_FORMAT: 0x03 + 0xE82A0100,
        AVCMR_BAD_HANDLE: 0x04 + 0xE82A0100,
        AVCMR_BAD_HC: 0x05 + 0xE82A0100,
        AVCMR_BAD_HCERT: 0x06 + 0xE82A0100,
        AVCMR_BAD_HENUM: 0x07 + 0xE82A0100,
        AVCMR_BAD_HMSG: 0x08 + 0xE82A0100,
        AVCMR_BAD_HSIGN: 0x09 + 0xE82A0100,
        AVCMR_BAD_NUMBER: 0x0A + 0xE82A0100,
        AVCMR_BAD_PASSWORD: 0x0B + 0xE82A0100,
        AVCMR_BUFFER_TOO_SMALL: 0x0C + 0xE82A0100,
        AVCMR_CERT_NOT_FOUND: 0x0D + 0xE82A0100,
        AVCMR_CERT_CA_INVALID: 0x0E + 0xE82A0100,
        AVCMR_CERT_CA_NOT_FOUND: 0x0F + 0xE82A0100,
        AVCMR_CERT_NOT_FOR_CRYPT: 0x11 + 0xE82A0100,
        AVCMR_CERT_NOT_FOR_SIGN: 0x12 + 0xE82A0100,
        AVCMR_CERT_SIGN_INVALID: 0x13 + 0xE82A0100,
        AVCMR_CERT_STORE_NOT_FOUND: 0x14 + 0xE82A0100,
        AVCMR_CONTAINER_NOT_FOUND: 0x15 + 0xE82A0100,
        AVCMR_CRL_INVALID: 0x16 + 0xE82A0100,
        AVCMR_CRL_NOT_FOUND: 0x17 + 0xE82A0100,
        AVCMR_DB_NOT_FOUND: 0x18 + 0xE82A0100,
        AVCMR_DEVICE_NOT_FOUND: 0x19 + 0xE82A0100,
        AVCMR_BUSY: 0x1A + 0xE82A0100,
        AVCMR_NO_DB_PARAMS: 0x1B + 0xE82A0100,
        AVCMR_NO_INPUT: 0x1C + 0xE82A0100,
        AVCMR_NO_SIGN: 0x1D + 0xE82A0100,
        AVCMR_ALREADY_INITIALIZED: 0x1E + 0xE82A0100,
        AVCMR_NOT_INITIALIZED: 0x1F + 0xE82A0100,
        AVCMR_BAD_DATE: 0x20 + 0xE82A0100,
        AVCMR_BAD_FLAGS: 0x21 + 0xE82A0100,
        AVCMR_BAD_THREAD: 0x22 + 0xE82A0100,
        AVCMR_DATE_NOT_VALID: 0x23 + 0xE82A0100,
        AVCMR_INTERNAL_ERROR: 0x24 + 0xE82A0100,
        AVCMR_NOT_FOUND: 0x25 + 0xE82A0100,
        AVCMR_NOT_IMPLEMENTED: 0x26 + 0xE82A0100,
        AVCMR_SIGN_INVALID: 0x27 + 0xE82A0100,
        AVCMR_USER_NO_AUTH: 0x28 + 0xE82A0100,
        AVCMR_BAD_PARAM: 0x29 + 0xE82A0100,
        AVCMR_BAD_FORMED_SIGN: 0x2A + 0xE82A0100,
        AVCMR_AVCSP_INIT_FAILED: 0x2B + 0xE82A0100,
        AVCMR_REGISTRY_ERROR: 0x2C + 0xE82A0100,
        AVCMR_WIN32_ERROR: 0x2D + 0xE82A0100,
        AVCMR_OTHER_RECIPIENT: 0x2E + 0xE82A0100,
        AVCMR_CTL_NOT_FOUND: 0x2F + 0xE82A0100,
        AVCMR_CERT_REVOKED: 0x30 + 0xE82A0100,
        AVCMR_CERT_NOT_TRUSTED: 0x31 + 0xE82A0100,
        AVCMR_CRL_EXPIRED: 0x32 + 0xE82A0100,
        AVCMR_CRL_ISSUER_NOT_FOUND: 0x33 + 0xE82A0100,
        AVCMR_CRL_ISSUER_EXPIRED: 0x34 + 0xE82A0100,
        AVCMR_CERT_STORE_BAD_VERSION: 0x35 + 0xE82A0100,
        AVCMR_MY_STORE_EMPTY: 0x36 + 0xE82A0100,
        AVCMR_USER_CANCEL: 0x37 + 0xE82A0100,
        AVCMR_RA_EXT_KEY_USAGE_NOT_ALLOWED: 0x38 + 0xE82A0100,
        AVCMR_RA_EXT_NOT_ALLOWED: 0x39 + 0xE82A0100,
        AVCMR_TOO_MANY_CERT: 0x3A + 0xE82A0100,
        AVCMR_PARAM_SPEC_NOT_FOUND: 0x40 + 0xE82A0100,
        AVCMR_CERT_NOT_RA: 0x41 + 0xE82A0100,
        AVCMR_ALREADY_EXISTS: 0x42 + 0xE82A0100,
        AVCMR_UNKNOWN_ERROR_CODE: 0x43 + 0xE82A0100,
        AVCMR_BAD_CRL_ISSUER: 0x44 + 0xE82A0100,
        AVCMR_OLD_CRL: 0x45 + 0xE82A0100,
        AVCMR_BAD_HCRL: 0x46 + 0xE82A0100,
        AVCMR_CERT_TEMPORARY_REVOKED: 0x47 + 0xE82A0100,
        AVCMR_REPEAT_AUTHENTICATION_ERROR: 0x48 + 0xE82A0100,
        AVCMR_DB_AUTHENTICATION_ERROR: 0x49 + 0xE82A0100,
        AVCMR_TOKEN_NOT_FOUND: 0x4A + 0xE82A0100,
        AVCMR_NO_CONTENT: 0x4B + 0xE82A0100,
        AVCMR_CERT_NOT_VALID_YET: 0x4C + 0xE82A0100,
        AVCMR_CERT_ALREADY_EXPIRED: 0x4D + 0xE82A0100,
        AVCMR_INVALID_TOKEN: 0x4E + 0xE82A0100,
        AVCMR_BAD_KEY: 0x4F + 0xE82A0100,
        AVCMR_TOKEN_WRITE_ERROR: 0x50 + 0xE82A0100,
        AVCMR_REQUEST_DENIED: 0x51 + 0xE82A0100,
        AVCMR_BAD_BUFFER_PTR: 0x52 + 0xE82A0100,
        AVCMR_OBJ_LOCKED: 0x53 + 0xE82A0100,
        AVCMR_NO_RECIPIENTS: 0x54 + 0xE82A0100,
        AVCMR_ALG_NOT_SUPPORTED: 0x55 + 0xE82A0100,
        AVCMR_CERT_NOT_REVOKED: 0x56 + 0xE82A0100,
        AVCMR_INTEGRITY_CHECK_FAILED: 0x57 + 0xE82A0100,
        AVCMR_REQUEST_FOR_CA_DENIED: 0x57 + 0xE82A0100,
        AVCMR_REQUEST_FOR_RA_DENIED: 0x58 + 0xE82A0100,
        AVCMR_REQUEST_FOR_REVOKE_DENIED: 0x59 + 0xE82A0100,
        AVCMR_INVALID_BASIC_CONSTRAINTS: 0x5A + 0xE82A0100,
        AVCMR_CRYPTSQL_SYNTAX_ERROR: 0x5B + 0xE82A0100,
        AVCMR_NOT_CONDITION: 0x5C + 0xE82A0100,
        AVCMR_VERIFY_ERROR: 0x5D + 0xE82A0100,
        AVCMR_BAD_DATA: 0x5E + 0xE82A0100,
        AVCMR_ORIGINAL_FILE_FOR_VERIFY_NOT_FOUND: 0x5F + 0xE82A0100,
        AVCMR_CERT_NOT_FOR_SIGN_CERT: 0x60 + 0xE82A0100,
        AVCMR_CERT_NOT_FOR_SIGN_CRL: 0x61 + 0xE82A0100,
        AVCMR_CERT_UNKNOWN_CRITICAL_EXT: 0x62 + 0xE82A0100,
        AVCMR_CRL_UNKNOWN_CRITICAL_EXT: 0x63 + 0xE82A0100,
        AVCMR_INVALID_KEY_USAGE: 0x64 + 0xE82A0100,
        AVCMR_INVALID_RACERT: 0x65 + 0xE82A0100,
        AVCMR_CRLSERVER_ERROR: 0x66 + 0xE82A0100,
        AVCMR_LOADLIBPKCS11_ERROR: 0x67 + 0xE82A0100,
        AVCMR_CRLDP_BAD_PATH: 0x68 + 0xE82A0100,
        AVCMR_RENEW_BAD_ATTR: 0x69 + 0xE82A0100,
        AVCMR_POLICY_NOT_FOUND: 0x70 + 0xE82A0100,
        AVCMR_POLICY_NOT_APPLY: 0x71 + 0xE82A0100,
        AVCMR_CERT_NOT_FOR_SIGN_ACERT: 0x72 + 0xE82A0100,
        AVCMR_OCSP_ERROR: 0x73 + 0xE82A0100,
        AVCMR_KEY_ALREADY_EXPIRED: 0x74 + 0xE82A0100,
        AVCMR_PKCS11_TOKEN_NOT_PRESENTERROR: 0x75 + 0xE82A0100,
        AVCMR_PKCS11_ERROR: 0x76 + 0xE82A0100,
        AVCMR_LDAP_ACTION_NOT_FOUND: 0x77 + 0xE82A0100,
        AVCMR_SCEP_PENDING: 0x78 + 0xE82A0100,
        AVCMR_SCEP_ERROR: 0x79 + 0xE82A0100
    }

    if (windowExists) {
        // making avcmx factory function global
        window.avcmx = avcmx;
        window.AvCMXError = AvCMXError;
        // making constants global
        for (var c in avcmx.constants) {
            window[c] = avcmx.constants[c];
        }
    }

    var makeSafe = function (fn) {
        return function () {
            try {
                return fn.apply(this, arguments);
            } catch (e) {
                // we do care only Error error type or any other types (e.g. string) thrown
                if (e instanceof EvalError || e instanceof RangeError ||
                    e instanceof ReferenceError || e instanceof SyntaxError ||
                    e instanceof TypeError || e instanceof URIError) {
                    throw e;
                }
                var lastError = instance.GetLastError();
                if (avcmx.oldActiveX && e.number !== undefined) {
                    throw new AvCMXError(e.number);
                } else if (lastError != 0) {
                    throw new AvCMXError(lastError);
                } else {
                    throw e;
                }
            }
        };
    };

    // wrapping unsafe methods
    var list = ["avcmx"].concat(objects, messages);
    for (var i = 0; i < list.length; i++) {
        var obj = list[i];
        if (obj == "Message") {
            continue;
        }
        var prot = (obj == "avcmx" ? avcmx : avcmx[obj]);
        var tmp = {};
        for (var method in prot.prototype) {
            // skip safe methods
            if (method in avcmxobject.prototype) {
                continue;
            }
            var unsafe = method + "_unsafe";
            tmp[unsafe] = prot.prototype[method];
            tmp[method] = makeSafe(tmp[unsafe]);
            //console.log("wrapping " + obj + "." + method);
        }
        prot.prototype = extend(prot.prototype, tmp);
    }

    list = "blob params version connection hash".split(" ");
    for (var i = 0; i < list.length; i++) {
        avcmx[list[i]] = (function (fn) {
            return function () {
                return fn.apply(avcmx(), arguments);
            };
        })(avcmx.prototype[list[i]]);
    }
})(window);