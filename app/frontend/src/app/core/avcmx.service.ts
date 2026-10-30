import { Injectable } from '@angular/core';

/**
 * Вызов плагина AvCMXWebP из «Комплекта абонента АВЕСТ».
 * На странице — object type="application/x-avcmx-web-plugin" и classid ActiveX
 * (ProgID AVEST.AvCMXWebP). Подпись отсоединённая, сертификат подписанта вложен.
 * Если в личном сертификате нет УНП, в подпись берётся атрибутный сертификат
 * с этим OID. Статус сертификата плагин проверяет по СОС.
 *
 * Chrome и Edge плагин не поднимают: AvCMXWebP — NPAPI/ActiveX, в Chromium
 * NPAPI снят с 2015 (демо АВЕСТ: IE, Firefox; Chrome только до 45).
 */

const AVCMF_NO_AUTH = 0x4;
const AVCMF_FORCE_TOKEN_CONTROL = 0x10000;
const AVCMF_ADD_SIGN_CERT = 0x100000;
const AVCMF_REPEAT_AUTHENTICATION = 0x800;
const AVCMF_DETACHED = 0x2000000;
const AVCM_TYPE = 0x26;
const AVCM_TYPE_MY = 0x10e;
const AVCM_PUB_KEY_ID = 0x100f;
const AVCMXF_ZT_STRING = 1;
const UNP_OID = '1.2.112.1.2.1.1.1.1.2';
const AVCMX_PROGID = 'AVEST.AvCMXWebP';

export interface EdsCertificate {
  pubKeyId: string;
  subject: string;
  issuer: string;
  hasUnp: boolean;
}

export interface EdsSignature {
  pkcs7: string;
  subject: string;
  issuer: string;
  attributeCertificate: boolean;
}

interface AvBlob {
  SetAsInteger(value: number, flags: number): void;
  SetAsText(value: string, flags: number): void;
  SetAsBase64(value: string, flags: number): void;
  GetAsHex(flags: number): string;
  GetAsBase64(flags: number): string;
}

interface AvParams {
  AddParameter(id: number, blob: AvBlob, flags: number): void;
}

interface AvCert {
  Subject: string;
  Issuer: string;
  PublicKeyId: AvBlob;
  GetSubjectNameAttributeByOid(oid: string, flags: number): { Value?: string };
  GetExtensionByOid(oid: string, flags: number): unknown;
}

interface AvAttr {
  Oid: string;
}

interface AvAttrCert {
  AttributesCount: number;
  GetAttributeByIndex(index: number, flags: number): AvAttr;
  GetAttributeByOid(oid: string, flags: number): AvAttr;
}

interface AvList {
  Count: number;
  Item(index: number): AvCert & AvAttrCert;
}

interface AvMessage {
  AttributeCertificate: AvAttrCert;
  Blob: AvBlob;
  Content: AvBlob;
  SignAsync(flags: number, callback: (code: number, signed?: AvMessage) => void): void;
  Verify(flags: number): void;
}

interface AvConnection {
  SelectCertificates(params: AvParams, flags: number): AvList;
  SelectAttributeCertificates(holder: AvCert, params: AvParams, flags: number): AvList;
  CreateMessage(blob: AvBlob | number, flags?: number): AvMessage;
}

interface AvPlugin {
  Version?: string;
  CreateBlob(flags: number): AvBlob;
  CreateParameters(flags: number): AvParams;
  CreateConnectionAsync(params: AvParams, flags: number, callback: (code: number, conn?: AvConnection) => void): void;
  GetLastError(): number | string;
  GetErrorInformation(code: number, flags: number): string;
}

type ActiveXFactory = new (progId: string) => AvPlugin;

@Injectable({ providedIn: 'root' })
export class AvcmxService {
  /** Держим ActiveX-экземпляр, чтобы его не собрал GC. */
  private activeX: AvPlugin | null = null;

  installed(): boolean {
    return this.plugin() !== null;
  }

  version(): string {
    return String(this.plugin()?.Version || '');
  }

  missingText(): string {
    if (this.chromiumBrowser()) {
      return (
        'Комплект АВЕСТ на компьютере может быть установлен, но этот браузер не загружает AvCMXWebP. ' +
        'Плагин — NPAPI/ActiveX; Chrome и Edge его не поднимают (в демо АВЕСТ: Internet Explorer и Firefox; Chrome только до версии 45). ' +
        'Откройте ПМ в Internet Explorer и нажмите «Подписать» снова. ' +
        'Проверка плагина у АВЕСТ: http://dev.avest.by/avjceprovdemoweb/. ' +
        'Дистрибутив: https://nces.by/pki/info/software'
      );
    }
    return (
      'Браузер не отдал API плагина AvCMXWebP (у объекта нет CreateBlob). ' +
      'Установите «Комплект абонента АВЕСТ» для AvPass вместе с AvCMXWebP со страницы НЦЭУ и откройте ПМ в Internet Explorer ' +
      '(или Firefox с NPAPI). Дистрибутив: https://nces.by/pki/info/software'
    );
  }

  async certificates(): Promise<EdsCertificate[]> {
    const plugin = this.requirePlugin();
    const conn = await this.connect(plugin, plugin.CreateParameters(0), AVCMF_NO_AUTH);
    const params = plugin.CreateParameters(0);
    const kind = plugin.CreateBlob(0);
    kind.SetAsInteger(AVCM_TYPE_MY, 0);
    params.AddParameter(AVCM_TYPE, kind, 0);
    const list = conn.SelectCertificates(params, 0);
    const rows: EdsCertificate[] = [];
    for (let index = 0; index < Number(list.Count || 0); index += 1) {
      const cert = list.Item(index);
      rows.push({
        pubKeyId: String(cert.PublicKeyId.GetAsHex(0) || ''),
        subject: String(cert.Subject || 'Сертификат без имени'),
        issuer: String(cert.Issuer || ''),
        hasUnp: this.hasUnp(plugin, cert),
      });
    }
    return rows.filter((row) => row.pubKeyId);
  }

  async signDetached(bytes: Uint8Array, certificate: EdsCertificate): Promise<EdsSignature> {
    const plugin = this.requirePlugin();
    const lookup = await this.connect(plugin, plugin.CreateParameters(0), AVCMF_NO_AUTH);
    const holder = this.findCert(lookup, plugin, certificate.pubKeyId);
    const attribute = this.hasUnp(plugin, holder) ? null : this.attributeCertificate(plugin, lookup, holder);
    const login = plugin.CreateParameters(0);
    const key = plugin.CreateBlob(0);
    key.SetAsText(certificate.pubKeyId, AVCMXF_ZT_STRING);
    login.AddParameter(AVCM_PUB_KEY_ID, key, 0);
    const conn = await this.connect(plugin, login, AVCMF_FORCE_TOKEN_CONTROL);
    const data = plugin.CreateBlob(0);
    data.SetAsBase64(toBase64(bytes), 0);
    const message = conn.CreateMessage(data, 0);
    if (attribute) message.AttributeCertificate = attribute;
    const signed = await this.asyncCall<AvMessage>((callback) => {
      message.SignAsync(AVCMF_DETACHED | AVCMF_ADD_SIGN_CERT | AVCMF_REPEAT_AUTHENTICATION, callback);
    });
    const pkcs7 = String(signed.Blob.GetAsBase64(0) || '').replace(/\s+/g, '');
    if (!pkcs7) throw new Error('Плагин не вернул подпись');
    const signature = plugin.CreateBlob(0);
    signature.SetAsBase64(pkcs7, 0);
    const check = conn.CreateMessage(signature, 0);
    check.Content = data;
    try {
      check.Verify(0);
    } catch (error) {
      throw new Error(this.pluginError(plugin, error));
    }
    return {
      pkcs7,
      subject: certificate.subject,
      issuer: certificate.issuer,
      attributeCertificate: attribute !== null,
    };
  }

  private requirePlugin(): AvPlugin {
    const plugin = this.plugin();
    if (!plugin) throw new Error(this.missingText());
    return plugin;
  }

  private plugin(): AvPlugin | null {
    const fromObject = this.fromPageObject();
    if (fromObject) return fromObject;
    return this.fromActiveX();
  }

  private fromPageObject(): AvPlugin | null {
    const node = document.getElementById('oavcmx');
    if (!node) return null;
    const plugin = node as unknown as AvPlugin;
    // В IE у методов ActiveX typeof часто "unknown", не "function".
    if (!this.hasCreateBlob(plugin)) return null;
    return plugin;
  }

  private fromActiveX(): AvPlugin | null {
    if (this.activeX && this.hasCreateBlob(this.activeX)) return this.activeX;
    const factory = (window as unknown as { ActiveXObject?: ActiveXFactory }).ActiveXObject;
    if (!factory) return null;
    try {
      const instance = new factory(AVCMX_PROGID);
      if (!instance || !this.hasCreateBlob(instance)) return null;
      this.activeX = instance;
      return instance;
    } catch {
      return null;
    }
  }

  /** ActiveX в IE: typeof method часто "unknown" — проверяем только вызовом. */
  private hasCreateBlob(plugin: AvPlugin): boolean {
    try {
      return plugin.CreateBlob(0) != null;
    } catch {
      return false;
    }
  }

  private chromiumBrowser(): boolean {
    const ua = navigator.userAgent;
    return /Chrome\/|Edg\/|OPR\//.test(ua) && !/Firefox\//.test(ua);
  }

  private connect(plugin: AvPlugin, params: AvParams, flags: number): Promise<AvConnection> {
    return this.asyncCall<AvConnection>((callback) => plugin.CreateConnectionAsync(params, flags, callback));
  }

  private asyncCall<T>(run: (callback: (code: number, value?: T) => void) => void): Promise<T> {
    const plugin = this.plugin();
    return new Promise((resolve, reject) => {
      try {
        run((code, value) => {
          if (code && typeof code === 'object') {
            const message = (code as { message?: string }).message;
            reject(new Error(message || this.missingText()));
            return;
          }
          const numeric = Number(code || 0);
          if (numeric) {
            reject(new Error(plugin ? this.pluginError(plugin, numeric) : this.missingText()));
            return;
          }
          if (value === undefined) {
            reject(new Error('Плагин AvCMXWebP не вернул результат'));
            return;
          }
          resolve(value);
        });
      } catch (error) {
        reject(new Error(plugin ? this.pluginError(plugin, error) : this.missingText()));
      }
    });
  }

  private findCert(conn: AvConnection, plugin: AvPlugin, pubKeyId: string): AvCert {
    const params = plugin.CreateParameters(0);
    const kind = plugin.CreateBlob(0);
    kind.SetAsInteger(AVCM_TYPE_MY, 0);
    params.AddParameter(AVCM_TYPE, kind, 0);
    const list = conn.SelectCertificates(params, 0);
    const wanted = pubKeyId.toLowerCase();
    for (let index = 0; index < Number(list.Count || 0); index += 1) {
      const cert = list.Item(index);
      if (String(cert.PublicKeyId.GetAsHex(0) || '').toLowerCase() === wanted) return cert;
    }
    throw new Error('Сертификат не найден в личном справочнике. Вставьте AvPass и обновите список.');
  }

  private hasUnp(plugin: AvPlugin, cert: AvCert): boolean {
    if (this.readValue(plugin, () => cert.GetSubjectNameAttributeByOid(UNP_OID, 0)?.Value)) return true;
    return Boolean(this.readValue(plugin, () => cert.GetExtensionByOid(UNP_OID, 0)));
  }

  private attributeCertificate(plugin: AvPlugin, conn: AvConnection, holder: AvCert): AvAttrCert {
    const list = conn.SelectAttributeCertificates(holder, plugin.CreateParameters(0), 0);
    for (let index = 0; index < Number(list.Count || 0); index += 1) {
      const certificate = list.Item(index);
      if (this.attributeHasUnp(plugin, certificate)) return certificate;
    }
    throw new Error(
      'В личном сертификате нет УНП, и в справочнике нет атрибутного сертификата с УНП. Импортируйте его в персональный менеджер сертификатов АВЕСТ.',
    );
  }

  private attributeHasUnp(plugin: AvPlugin, certificate: AvAttrCert): boolean {
    if (this.readValue(plugin, () => certificate.GetAttributeByOid(UNP_OID, 0))) return true;
    const count = Number(certificate.AttributesCount || 0);
    for (let index = 0; index < count; index += 1) {
      const oid = this.readValue(plugin, () => certificate.GetAttributeByIndex(index, 0)?.Oid);
      if (oid === UNP_OID) return true;
    }
    return false;
  }

  private readValue(plugin: AvPlugin, read: () => unknown): boolean | string {
    try {
      const value = read();
      if (value === undefined || value === null || value === '') return false;
      return typeof value === 'string' ? value : true;
    } catch {
      const code = Number(plugin.GetLastError?.() || 0);
      if ((code & 0xFFFF) === 0x25 || code === 0) return false;
      throw new Error(this.pluginError(plugin, code));
    }
  }

  private pluginError(plugin: AvPlugin, error: unknown): string {
    const code = typeof error === 'number' ? error : Number(plugin.GetLastError?.() || 0);
    let text = '';
    try {
      text = String(plugin.GetErrorInformation?.(code, 0) || '');
    } catch {
      text = '';
    }
    if (!text && error instanceof Error && error.message) text = error.message;
    const low = code & 0xFFFF;
    const known: Record<number, string> = {
      0x0b: 'Неверный пароль к контейнеру AvPass',
      0x15: 'Контейнер личного ключа на носителе не найден',
      0x17: 'Нет списка отозванных сертификатов. Обновите СОС в персональном менеджере сертификатов АВЕСТ',
      0x19: 'Носитель AvPass не найден',
      0x27: 'Подпись не прошла проверку',
      0x30: 'Сертификат отозван. Проверьте список отозванных сертификатов',
      0x32: 'Список отозванных сертификатов просрочен. Обновите СОС в персональном менеджере сертификатов АВЕСТ',
      0x37: 'Подпись отменена',
      0x4a: 'Вставьте носитель AvPass',
    };
    return text || known[low] || 'Плагин AvCMXWebP не выполнил подпись';
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}
