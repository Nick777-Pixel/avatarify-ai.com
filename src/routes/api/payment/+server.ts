import type { RequestHandler } from './$types';
import { error as svelteError, json } from '@sveltejs/kit';
import { PRIVATE_STRIPE_API_KEY, PRIVATE_STRIPE_ENDPOINT_SECRET } from '$env/static/private';
import { supabaseClientAdmin } from '$lib/db.server';
import { Stripe } from 'stripe';
import type { User } from '@supabase/supabase-js';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const signature = request.headers.get('stripe-signature') ?? '';

		const stripe = new Stripe.Stripe(PRIVATE_STRIPE_API_KEY, { apiVersion: '2022-11-15' });

		const event = await stripe.webhooks.constructEventAsync(
			await request.text(),
			signature,
			PRIVATE_STRIPE_ENDPOINT_SECRET
		);

		switch (event.type) {
			case 'checkout.session.completed': {
				const session = event.data.object as Stripe.Checkout.Session;
				const client_reference_id = session.client_reference_id;
				const email = session.customer_email || session.customer_details?.email;
				console.log('session: ', session);
				if (client_reference_id || email) {
					let user: User | null = null;

					if (client_reference_id) {
						const { data, error } = await supabaseClientAdmin.auth.admin.getUserById(
							client_reference_id
						);
						if (error) {
							throw error;
						}
						user = data.user;
					} else if (email) {
						const { data, error } = await supabaseClientAdmin.auth.admin.inviteUserByEmail(email);
						if (error) {
							throw error;
						}
						user = data.user;
					}

					if (user) {
						const { error: errorUpsert } = await supabaseClientAdmin
							.from('user_info')
							.upsert({ id: user.id, paid: true });

						if (errorUpsert) {
							throw errorUpsert;
						}
					} else {
						throw new Error(`User not found: ref_id ${client_reference_id}, email:${email}`);
					}
				} else {
					throw new Error('Missing reference id and email');
				}

				// Then define and call a function to handle the event checkout.session.completed
				break;
			}
			// ... handle other event types
			default:
				console.log(`Unhandled event type ${event.type}`);
		}

		return json({ done: true });
	} catch (error) {
		console.error(error);
		if (error instanceof Error) {
			console.error(error.cause);
			throw svelteError(500, { message: error.message });
		}
		throw svelteError(500);
	}
};
