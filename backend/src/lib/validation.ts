import { z } from 'zod';

export const emailSchema = z
  .string()
  // Trim and lowercase BEFORE validating: a transform after the check rejects
  // the trailing space that autofill and copy-paste routinely add, instead of
  // cleaning it. Normalising first also means one casing is ever stored.
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.').max(254));

/**
 * Length is the dominant factor in password strength, so we ask for 10+ rather
 * than stacking character-class rules that mostly push people toward "P@ssw0rd".
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(200, 'Password must be at most 200 characters.');

/** E.164: leading +, country code, up to 15 digits total. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Enter a phone number in international format, e.g. +919876543210.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Name cannot be empty.')
  .max(80, 'Name must be at most 80 characters.');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email or username is required.').max(254),
  password: z.string().min(1, 'Password is required.'),
  adminOnly: z.boolean().optional(),
});

export const otpRequestSchema = z.object({
  phone: phoneSchema,
});

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  adminOnly: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.nullish(),
    bio: z.string().trim().max(500, 'Bio must be at most 500 characters.').nullish(),
    // External image links only. A data: URI here means a client echoed back a
    // locally generated placeholder (or tried to inline an upload); real
    // uploads go to POST /api/profile/avatar and are stored as bytes.
    avatarUrl: z
      .url('Enter a valid image URL.')
      .max(1000)
      .refine((value) => !/^data:/i.test(value), {
        message: 'Upload pictures via /api/profile/avatar, not as a data URI.',
      })
      .nullish(),
    dateOfBirth: z.iso.date('Use the format YYYY-MM-DD.').nullish(),
    locale: z.string().trim().min(2).max(12).optional(),
    timezone: z.string().trim().max(64).nullish(),
    country: z.string().trim().max(64).nullish(),
    state: z.string().trim().max(64).nullish(),
    city: z.string().trim().max(64).nullish(),
    // Contact number only — the verified login `phone` is not editable here.
    contactPhone: z.string().trim().max(32).nullish(),
    digestFrequency: z.enum(['DAILY', 'WEEKLY', 'OFF']).optional(),
    preferredTopics: z.array(z.string().trim().min(1).max(48)).max(20).optional(),
    notifyBreakingNews: z.boolean().optional(),
    notifyNewsletter: z.boolean().optional(),
    notifyProductNews: z.boolean().optional(),
  })
  // Guards against a PATCH with an empty or entirely unknown body silently
  // reporting success while changing nothing.
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: passwordSchema,
});

export const billingPeriodSchema = z.enum(['MONTHLY', 'ANNUAL']);

export const checkoutSchema = z.object({
  period: billingPeriodSchema,
  promoCode: z.string().trim().max(40).optional(),
});

export const confirmPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export const grantSubscriptionSchema = z.object({
  userId: z.string().min(1),
  period: billingPeriodSchema,
  note: z.string().trim().max(300).optional(),
});

export const subscribeNewsletterSchema = z.object({
  email: emailSchema,
});
