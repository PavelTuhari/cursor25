/**
 * Constructs the `<Signatures>` block that e-Factura expects.
 *
 * Shape, from chapter 5 of the CTIF integration guide:
 *
 *   <Signatures>
 *     <SignatureContent>
 *       <SignedDoc>
 *         <hash Id="_uuid">HEX</hash>
 *         <Signature xmlns="http://www.w3.org/2000/09/xmldsig#"> ... </Signature>
 *       </SignedDoc>
 *     </SignatureContent>
 *     ... one SignatureContent per signature, in signing order ...
 *   </Signatures>
 *
 * The enveloped signature covers the `<hash>` element by its `Id`, and each new
 * signature is appended without touching the ones already there.
 *
 * IMPORTANT - the guide prints the resulting XML but never states which bytes
 * feed the `<hash>` digest. This module hashes the exclusive-C14N form of
 * `<SupplierInfo>`, which is the only reading consistent with the examples, and
 * exposes `hashInput` so the choice can be re-pointed from one place once the
 * SFS sandbox confirms it. Do not go to production without that confirmation:
 * a wrong digest is accepted by `PostInvoices` and rejected later at signature
 * verification, which is a much more expensive place to find out.
 */
import { createHash, randomUUID } from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { ExclusiveCanonicalization } from 'xml-crypto';

import { escapeXml } from '../sfs/soap.js';
import type { SignatureMaterial } from './signer.js';

export const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
export const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
export const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

const ALGORITHM = {
  sha1: {
    digest: 'http://www.w3.org/2000/09/xmldsig#sha1',
    signature: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    node: 'sha1',
  },
  sha256: {
    digest: 'http://www.w3.org/2001/04/xmlenc#sha256',
    signature: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    node: 'sha256',
  },
} as const;

/** Prefix list reproduced verbatim from the guide's samples. */
const INCLUSIVE_PREFIXES = '#default samlp saml ds xs xsi';

type C14nNode = Parameters<ExclusiveCanonicalization['process']>[0];

function canonicalise(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const c14n = new ExclusiveCanonicalization();
  // xmldom's Element and the lib.dom Element that xml-crypto declares are the
  // same object at runtime; TypeScript only sees two unrelated declarations.
  return c14n.process(doc.documentElement as unknown as C14nNode, {
    inclusiveNamespacesPrefixList: [],
  }) as string;
}

/**
 * The bytes that go into `<hash>`. Isolated deliberately - see the module note.
 */
export function hashInput(documentXml: string): string {
  const doc = new DOMParser().parseFromString(documentXml, 'text/xml');
  const supplierInfo = doc.getElementsByTagName('SupplierInfo')[0];
  if (!supplierInfo) throw new Error('document has no <SupplierInfo> element');
  return canonicalise(new XMLSerializer().serializeToString(supplierInfo));
}

/** Uppercase hex, matching the 40-character SHA-1 digests in the guide. */
export function documentHash(documentXml: string, digest: 'sha1' | 'sha256' = 'sha1'): string {
  return createHash(ALGORITHM[digest].node)
    .update(hashInput(documentXml), 'utf8')
    .digest('hex')
    .toUpperCase();
}

interface SignedInfoParts {
  hashId: string;
  digestValue: string;
  digest: 'sha1' | 'sha256';
}

function signedInfoXml(parts: SignedInfoParts): string {
  const algorithm = ALGORITHM[parts.digest];
  return (
    `<SignedInfo xmlns="${DSIG_NS}">` +
    `<CanonicalizationMethod Algorithm="${EXC_C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${algorithm.signature}"></SignatureMethod>` +
    `<Reference URI="#${parts.hashId}">` +
    `<Transforms>` +
    `<Transform Algorithm="${ENVELOPED}"></Transform>` +
    `<Transform Algorithm="${EXC_C14N}">` +
    `<InclusiveNamespaces xmlns="${EXC_C14N}" PrefixList="${INCLUSIVE_PREFIXES}"></InclusiveNamespaces>` +
    `</Transform>` +
    `</Transforms>` +
    `<DigestMethod Algorithm="${algorithm.digest}"></DigestMethod>` +
    `<DigestValue>${parts.digestValue}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>`
  );
}

export interface SignatureContentOptions {
  documentXml: string;
  material: SignatureMaterial;
  digest?: 'sha1' | 'sha256';
  /** Injected in tests to make the output reproducible. */
  hashId?: string;
}

/** Builds one `<SignatureContent>` element for the given document. */
export async function buildSignatureContent(
  options: SignatureContentOptions,
): Promise<string> {
  const digest = options.digest ?? 'sha1';
  const hashId = options.hashId ?? `_${randomUUID()}`;
  const hashHex = documentHash(options.documentXml, digest);

  // The Reference points at <hash>, so the digest is taken over that element
  // with the enveloped-signature transform applied - which, since no signature
  // is inside it yet, is the canonical form of <hash> itself.
  const hashElement = `<hash Id="${hashId}">${hashHex}</hash>`;
  const digestValue = createHash(ALGORITHM[digest].node)
    .update(canonicalise(hashElement), 'utf8')
    .digest('base64');

  const signedInfo = signedInfoXml({ hashId, digestValue, digest });
  const signatureValue = await options.material.sign(
    Buffer.from(canonicalise(signedInfo), 'utf8'),
    digest,
  );

  return (
    `<SignatureContent>` +
    `<SignedDoc>` +
    hashElement +
    `<Signature xmlns="${DSIG_NS}">` +
    signedInfo.replace(` xmlns="${DSIG_NS}"`, '') +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    `<KeyInfo>` +
    `<X509Data>` +
    `<X509Certificate>${escapeXml(options.material.certificateBase64)}</X509Certificate>` +
    `</X509Data>` +
    `</KeyInfo>` +
    `</Signature>` +
    `</SignedDoc>` +
    `</SignatureContent>`
  );
}

/**
 * Appends a `<SignatureContent>` to the document, creating `<Signatures>` on the
 * first call. Repeated calls stack signatures in order, which is how the buyer's
 * signature joins the supplier's.
 */
export function appendSignature(documentXml: string, signatureContent: string): string {
  if (documentXml.includes('</Signatures>')) {
    return documentXml.replace('</Signatures>', `${signatureContent}</Signatures>`);
  }
  const closing = documentXml.lastIndexOf('</Document>');
  if (closing === -1) throw new Error('document has no closing </Document> tag');
  return (
    documentXml.slice(0, closing) +
    `<Signatures>${signatureContent}</Signatures>` +
    documentXml.slice(closing)
  );
}

/** Number of signatures already present, i.e. the next signing `Order`. */
export function signatureCount(documentXml: string): number {
  return (documentXml.match(/<SignatureContent>/g) ?? []).length;
}
