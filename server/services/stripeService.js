import Stripe from "stripe";
import { conflict } from "../errors/ApiError.js";

const stripeClient = () => {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!secretKey.startsWith("sk_test_")) {
    throw conflict("Stripe test mode is not configured on the API.");
  }
  return new Stripe(secretKey);
};

const stripeAmount = (amount) => Math.round(Number(amount) * 100);

export const createStripeCheckout = async ({
  session,
  invoice,
  customerEmail,
  clientOrigin,
}) => {
  const stripe = stripeClient();
  const resultPath = invoice.stage === "deposit" && invoice.carePlanId
    ? `/care-checkout?plan=${encodeURIComponent(invoice.carePlanId)}`
    : "/client/payments?source=stripe";
  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    invoice_creation: {
      enabled: true,
      invoice_data: {
        description: invoice.description || "SwiftOpsBD care payment",
        footer: "Thank you for choosing SwiftOpsBD Payment System.",
        metadata: {
          localSessionId: session.sessionId,
          swiftOpsInvoiceId: invoice.invoiceId,
        },
      },
    },
    client_reference_id: session.sessionId,
    customer_email: customerEmail || undefined,
    branding_settings: {
      display_name: "SwiftOpsBD Payment System",
      background_color: "#ffffff",
      button_color: "#0649ad",
      border_style: "rounded",
      font_family: "inter",
    },
    custom_text: {
      submit: {
        message: "Secure test payment for SwiftOpsBD Payment System.",
      },
    },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: String(invoice.currency || "USD").toLowerCase(),
        unit_amount: stripeAmount(invoice.total),
        product_data: {
          name: invoice.description || "SwiftOpsBD care payment",
          metadata: { invoiceId: invoice.invoiceId },
        },
      },
    }],
    metadata: {
      localSessionId: session.sessionId,
      invoiceId: invoice.invoiceId,
      clientId: invoice.clientId,
      stage: invoice.stage || "invoice",
    },
    payment_intent_data: {
      statement_descriptor_suffix: "SWIFTOPSBD",
      metadata: {
        localSessionId: session.sessionId,
        invoiceId: invoice.invoiceId,
      },
    },
    success_url: `${clientOrigin}${resultPath}&payment=success&payment_session=${encodeURIComponent(session.sessionId)}&stripe_session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientOrigin}${resultPath}&payment=cancel`,
  });
  return {
    gateway: "stripe",
    gatewaySessionId: checkout.id,
    gatewayUrl: checkout.url,
    gatewayCurrency: checkout.currency?.toUpperCase() || invoice.currency,
  };
};

export const retrieveStripeInvoiceDetails = async (checkout) => {
  const invoiceId = typeof checkout.invoice === "string"
    ? checkout.invoice
    : checkout.invoice?.id;
  if (!invoiceId) return {};
  const invoice = await stripeClient().invoices.retrieve(invoiceId);
  return {
    stripeInvoiceId: invoice.id,
    stripeInvoiceNumber: invoice.number || null,
    stripeInvoiceUrl: invoice.hosted_invoice_url || null,
    stripeInvoicePdf: invoice.invoice_pdf || null,
  };
};

export const retrieveStripeCheckout = async (checkoutSessionId) =>
  stripeClient().checkout.sessions.retrieve(checkoutSessionId);

export const constructStripeEvent = ({ payload, signature }) => {
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!webhookSecret.startsWith("whsec_")) {
    throw conflict("Stripe webhook verification is not configured.");
  }
  return stripeClient().webhooks.constructEvent(
    payload,
    signature,
    webhookSecret,
  );
};

export const assertStripeCheckoutMatches = ({ checkout, session, invoice }) => {
  const expectedAmount = stripeAmount(invoice.total);
  const expectedCurrency = String(invoice.currency || "USD").toLowerCase();
  if (
    checkout.metadata?.localSessionId !== session.sessionId ||
    checkout.metadata?.invoiceId !== invoice.invoiceId ||
    checkout.amount_total !== expectedAmount ||
    checkout.currency !== expectedCurrency ||
    checkout.payment_status !== "paid"
  ) {
    throw conflict("Stripe payment details did not match the invoice.");
  }
  return {
    gateway: "stripe",
    gatewayMode: "test",
    gatewaySessionId: checkout.id,
    gatewayPaymentIntentId: checkout.payment_intent || null,
    gatewayCurrency: checkout.currency.toUpperCase(),
    gatewayAmount: invoice.total,
  };
};
