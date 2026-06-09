<?php
/**
 * Plugin Name: WordPress MCP Connector Companion
 * Description: Optional companion endpoints for the local WordPress MCP Connector. Adds llms.txt support, LiteSpeed cache purge, guarded package installs, and backup export endpoints.
 * Version: 0.2.1
 * Author: Local WordPress MCP Connector
 * Requires at least: 6.4
 * Requires PHP: 8.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'WPMCC_VERSION', '0.2.1' );
define( 'WPMCC_OPTION_LLMS_TXT', 'wpmcc_llms_txt' );
define( 'WPMCC_OPTION_LLMS_FULL_TXT', 'wpmcc_llms_full_txt' );
define( 'WPMCC_OPTION_PERMISSIONS', 'wpmcc_permissions' );

function wpmcc_default_permissions() {
	return array(
		'llms_text'        => true,
		'backup_exports'   => true,
		'litespeed_cache'  => false,
		'package_installs' => false,
	);
}

function wpmcc_get_permissions() {
	$stored = get_option( WPMCC_OPTION_PERMISSIONS, array() );
	if ( ! is_array( $stored ) ) {
		$stored = array();
	}
	return array_merge( wpmcc_default_permissions(), array_map( 'rest_sanitize_boolean', $stored ) );
}

function wpmcc_update_permissions( array $permissions ) {
	$current = wpmcc_get_permissions();
	foreach ( array_keys( wpmcc_default_permissions() ) as $key ) {
		if ( array_key_exists( $key, $permissions ) ) {
			$current[ $key ] = rest_sanitize_boolean( $permissions[ $key ] );
		}
	}
	update_option( WPMCC_OPTION_PERMISSIONS, $current, false );
	return $current;
}

function wpmcc_package_installs_allowed() {
	$permissions = wpmcc_get_permissions();
	$allowed     = ! empty( $permissions['package_installs'] );
	if ( defined( 'WPMC_ALLOW_PACKAGE_INSTALLS' ) ) {
		$allowed = true === WPMC_ALLOW_PACKAGE_INSTALLS;
	}
	return (bool) apply_filters( 'wpmcc_package_installs_allowed', $allowed );
}

function wpmcc_backup_exports_allowed() {
	$permissions = wpmcc_get_permissions();
	return (bool) apply_filters( 'wpmcc_backup_exports_allowed', ! empty( $permissions['backup_exports'] ) );
}

function wpmcc_litespeed_cache_allowed() {
	$permissions = wpmcc_get_permissions();
	return (bool) apply_filters( 'wpmcc_litespeed_cache_allowed', ! empty( $permissions['litespeed_cache'] ) );
}

function wpmcc_can_manage_options() {
	return current_user_can( 'manage_options' );
}

function wpmcc_can_install_package( WP_REST_Request $request ) {
	$type = $request->get_param( 'type' );
	if ( 'plugin' === $type ) {
		return current_user_can( 'install_plugins' );
	}
	if ( 'theme' === $type ) {
		return current_user_can( 'install_themes' );
	}
	return current_user_can( 'manage_options' );
}

function wpmcc_rest_error( $code, $message, $status = 400 ) {
	return new WP_Error( $code, $message, array( 'status' => $status ) );
}

function wpmcc_litespeed_cache_detected() {
	return has_action( 'litespeed_purge_all' )
		|| has_action( 'litespeed_purge_url' )
		|| defined( 'LSCWP_V' )
		|| defined( 'LSCWP_VERSION' );
}

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'wp-mcp-connector/v1',
			'/status',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'wpmcc_can_manage_options',
				'callback'            => function () {
					return rest_ensure_response(
						array(
							'ok'                        => true,
							'version'                   => WPMCC_VERSION,
							'permissions'               => wpmcc_get_permissions(),
							'package_installs_allowed'  => wpmcc_package_installs_allowed(),
							'backup_exports_allowed'    => wpmcc_backup_exports_allowed(),
							'litespeed_cache_allowed'   => wpmcc_litespeed_cache_allowed(),
							'litespeed_cache_detected'  => wpmcc_litespeed_cache_detected(),
							'serves_llms_txt'           => true,
							'serves_llms_full_txt'      => true,
							'supports_backup_export'    => true,
							'package_install_constant'  => 'WPMC_ALLOW_PACKAGE_INSTALLS',
						)
					);
				},
			)
		);

		register_rest_route(
			'wp-mcp-connector/v1',
			'/llms-text',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'wpmcc_can_manage_options',
				'args'                => array(
					'target'  => array(
						'type'     => 'string',
						'required' => true,
						'enum'     => array( 'llms.txt', 'llms-full.txt' ),
					),
					'content' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
				'callback'            => function ( WP_REST_Request $request ) {
					$permissions = wpmcc_get_permissions();
					if ( empty( $permissions['llms_text'] ) ) {
						return wpmcc_rest_error( 'llms_text_disabled', 'llms.txt management is disabled in companion permissions.', 403 );
					}

					$target  = $request->get_param( 'target' );
					$content = str_replace( "\r\n", "\n", (string) $request->get_param( 'content' ) );
					$option  = 'llms-full.txt' === $target ? WPMCC_OPTION_LLMS_FULL_TXT : WPMCC_OPTION_LLMS_TXT;

					update_option( $option, $content, false );

					return rest_ensure_response(
						array(
							'ok'      => true,
							'target'  => $target,
							'length'  => strlen( $content ),
							'url'     => home_url( '/' . $target ),
							'message' => $target . ' updated.',
						)
					);
				},
			)
		);

		register_rest_route(
			'wp-mcp-connector/v1',
			'/install-package',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'wpmcc_can_install_package',
				'args'                => array(
					'type'        => array(
						'type'     => 'string',
						'required' => true,
						'enum'     => array( 'plugin', 'theme' ),
					),
					'filename'    => array(
						'type'     => 'string',
						'required' => true,
					),
					'file_base64' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
				'callback'            => 'wpmcc_install_package',
			)
		);

		register_rest_route(
			'wp-mcp-connector/v1',
			'/permissions',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => 'wpmcc_can_manage_options',
					'callback'            => function () {
						return rest_ensure_response(
							array(
								'ok'                       => true,
								'permissions'              => wpmcc_get_permissions(),
								'package_installs_allowed' => wpmcc_package_installs_allowed(),
								'backup_exports_allowed'   => wpmcc_backup_exports_allowed(),
								'litespeed_cache_allowed'  => wpmcc_litespeed_cache_allowed(),
								'litespeed_cache_detected' => wpmcc_litespeed_cache_detected(),
							)
						);
					},
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'permission_callback' => 'wpmcc_can_manage_options',
					'args'                => array(
						'llms_text'        => array(
							'type' => 'boolean',
						),
						'package_installs' => array(
							'type' => 'boolean',
						),
						'backup_exports'   => array(
							'type' => 'boolean',
						),
						'litespeed_cache'  => array(
							'type' => 'boolean',
						),
					),
					'callback'            => function ( WP_REST_Request $request ) {
						$payload = array();
						foreach ( array( 'llms_text', 'package_installs', 'backup_exports', 'litespeed_cache' ) as $key ) {
							if ( null !== $request->get_param( $key ) ) {
								$payload[ $key ] = $request->get_param( $key );
							}
						}
						$permissions = wpmcc_update_permissions( $payload );

						return rest_ensure_response(
							array(
								'ok'                       => true,
								'permissions'              => $permissions,
								'package_installs_allowed' => wpmcc_package_installs_allowed(),
								'backup_exports_allowed'   => wpmcc_backup_exports_allowed(),
								'litespeed_cache_allowed'  => wpmcc_litespeed_cache_allowed(),
								'litespeed_cache_detected' => wpmcc_litespeed_cache_detected(),
								'message'                  => 'Companion permissions updated.',
							)
						);
					},
				),
			)
		);

		register_rest_route(
			'wp-mcp-connector/v1',
			'/litespeed-cache/purge',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'wpmcc_can_manage_options',
				'args'                => array(
					'mode'      => array(
						'type'    => 'string',
						'default' => 'all',
						'enum'    => array( 'all', 'url', 'post', 'post_type', 'object' ),
					),
					'url'       => array(
						'type' => 'string',
					),
					'post_id'   => array(
						'type' => 'integer',
					),
					'post_type' => array(
						'type' => 'string',
					),
				),
				'callback'            => 'wpmcc_purge_litespeed_cache',
			)
		);

		register_rest_route(
			'wp-mcp-connector/v1',
			'/backup-export',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'wpmcc_can_manage_options',
				'args'                => array(
					'include_media_catalog' => array(
						'type'    => 'boolean',
						'default' => true,
					),
				),
				'callback'            => 'wpmcc_backup_export',
			)
		);
	}
);

function wpmcc_purge_litespeed_cache( WP_REST_Request $request ) {
	if ( ! wpmcc_litespeed_cache_allowed() ) {
		return wpmcc_rest_error(
			'litespeed_cache_disabled',
			'LiteSpeed cache purge is disabled. Enable the local dashboard LiteSpeed cache permission for this site.',
			403
		);
	}

	if ( ! wpmcc_litespeed_cache_detected() ) {
		return wpmcc_rest_error(
			'litespeed_cache_not_detected',
			'LiteSpeed Cache plugin hooks were not detected on this site.',
			404
		);
	}

	$mode = sanitize_key( (string) $request->get_param( 'mode' ) );
	if ( '' === $mode ) {
		$mode = 'all';
	}

	switch ( $mode ) {
		case 'all':
			do_action( 'litespeed_purge_all' );
			break;

		case 'url':
			$url = esc_url_raw( (string) $request->get_param( 'url' ) );
			if ( '' === $url ) {
				return wpmcc_rest_error( 'missing_url', 'url is required when mode is url.' );
			}
			do_action( 'litespeed_purge_url', $url );
			break;

		case 'post':
			$post_id = absint( $request->get_param( 'post_id' ) );
			if ( ! $post_id ) {
				return wpmcc_rest_error( 'missing_post_id', 'post_id is required when mode is post.' );
			}
			do_action( 'litespeed_purge_post', $post_id );
			break;

		case 'post_type':
			$post_type = sanitize_key( (string) $request->get_param( 'post_type' ) );
			if ( '' === $post_type ) {
				return wpmcc_rest_error( 'missing_post_type', 'post_type is required when mode is post_type.' );
			}
			do_action( 'litespeed_purge_posttype', $post_type );
			break;

		case 'object':
			do_action( 'litespeed_purge_all_object' );
			break;

		default:
			return wpmcc_rest_error( 'invalid_litespeed_purge_mode', 'Unsupported LiteSpeed cache purge mode.' );
	}

	return rest_ensure_response(
		array(
			'ok'                       => true,
			'mode'                     => $mode,
			'litespeed_cache_detected' => wpmcc_litespeed_cache_detected(),
			'message'                  => 'LiteSpeed cache purge requested.',
		)
	);
}

function wpmcc_meta_allowed_for_backup( $key ) {
	if ( preg_match( '/password|secret|token|credential|authorization|oauth|session|nonce|api[_-]?key/i', (string) $key ) ) {
		return false;
	}

	$allowlist = apply_filters(
		'wpmcc_backup_meta_allowlist',
		array(
			'_thumbnail_id',
			'_wp_page_template',
			'_wp_old_slug',
			'_rank_math',
			'rank_math',
			'_yoast_wpseo',
			'_seopress',
			'_aioseo',
			'_elementor',
			'_wpb_',
			'canonical',
			'noindex',
			'schema',
			'faq',
			'score',
			'rating',
			'source',
			'vr_',
			'byd_',
		)
	);

	foreach ( $allowlist as $prefix ) {
		if ( 0 === strpos( (string) $key, (string) $prefix ) ) {
			return true;
		}
	}

	return false;
}

function wpmcc_export_post_meta( $post_id ) {
	$meta   = get_post_meta( $post_id );
	$result = array();

	foreach ( $meta as $key => $values ) {
		if ( ! wpmcc_meta_allowed_for_backup( $key ) ) {
			continue;
		}
		$result[ $key ] = array_map( 'maybe_unserialize', (array) $values );
	}

	return $result;
}

function wpmcc_export_terms_for_post( $post ) {
	$taxonomies = get_object_taxonomies( $post->post_type );
	if ( empty( $taxonomies ) ) {
		return array();
	}

	$terms = wp_get_object_terms( $post->ID, $taxonomies );
	if ( is_wp_error( $terms ) ) {
		return array();
	}

	return array_map(
		function ( $term ) {
			return array(
				'term_id'  => $term->term_id,
				'taxonomy' => $term->taxonomy,
				'name'     => $term->name,
				'slug'     => $term->slug,
			);
		},
		$terms
	);
}

function wpmcc_export_post( $post ) {
	return array(
		'id'              => $post->ID,
		'type'            => $post->post_type,
		'status'          => $post->post_status,
		'slug'            => $post->post_name,
		'date'            => $post->post_date,
		'date_gmt'        => $post->post_date_gmt,
		'modified'        => $post->post_modified,
		'modified_gmt'    => $post->post_modified_gmt,
		'title'           => $post->post_title,
		'content'         => $post->post_content,
		'excerpt'         => $post->post_excerpt,
		'author'          => (int) $post->post_author,
		'parent'          => (int) $post->post_parent,
		'menu_order'      => (int) $post->menu_order,
		'comment_status'  => $post->comment_status,
		'ping_status'     => $post->ping_status,
		'template'        => get_page_template_slug( $post ),
		'featured_media'  => (int) get_post_thumbnail_id( $post ),
		'permalink'       => get_permalink( $post ),
		'terms'           => wpmcc_export_terms_for_post( $post ),
		'meta'            => wpmcc_export_post_meta( $post->ID ),
	);
}

function wpmcc_export_content() {
	$result     = array();
	$post_types = get_post_types( array( 'show_in_rest' => true ), 'objects' );

	foreach ( $post_types as $post_type ) {
		if ( 'attachment' === $post_type->name ) {
			continue;
		}

		$posts = get_posts(
			array(
				'post_type'        => $post_type->name,
				'post_status'      => 'any',
				'posts_per_page'   => -1,
				'orderby'          => 'ID',
				'order'            => 'ASC',
				'suppress_filters' => false,
			)
		);

		$result[] = array(
			'type'      => $post_type->name,
			'label'     => $post_type->label,
			'rest_base' => $post_type->rest_base,
			'count'     => count( $posts ),
			'items'     => array_map( 'wpmcc_export_post', $posts ),
		);
	}

	return $result;
}

function wpmcc_export_taxonomies() {
	$result     = array();
	$taxonomies = get_taxonomies( array( 'show_in_rest' => true ), 'objects' );

	foreach ( $taxonomies as $taxonomy ) {
		$terms = get_terms(
			array(
				'taxonomy'   => $taxonomy->name,
				'hide_empty' => false,
			)
		);
		if ( is_wp_error( $terms ) ) {
			$terms = array();
		}

		$result[] = array(
			'taxonomy'     => $taxonomy->name,
			'label'        => $taxonomy->label,
			'rest_base'    => $taxonomy->rest_base,
			'hierarchical' => (bool) $taxonomy->hierarchical,
			'count'        => count( $terms ),
			'items'        => array_map(
				function ( $term ) {
					return array(
						'term_id'     => $term->term_id,
						'name'        => $term->name,
						'slug'        => $term->slug,
						'taxonomy'    => $term->taxonomy,
						'description' => $term->description,
						'parent'      => (int) $term->parent,
						'count'       => (int) $term->count,
					);
				},
				$terms
			),
		);
	}

	return $result;
}

function wpmcc_export_menus() {
	$menus = wp_get_nav_menus();
	return array_map(
		function ( $menu ) {
			$items = wp_get_nav_menu_items( $menu->term_id );
			return array(
				'term_id' => $menu->term_id,
				'name'    => $menu->name,
				'slug'    => $menu->slug,
				'items'   => array_map(
					function ( $item ) {
						return array(
							'id'          => $item->ID,
							'title'       => $item->title,
							'url'         => $item->url,
							'type'        => $item->type,
							'object'      => $item->object,
							'object_id'   => (int) $item->object_id,
							'menu_order'  => (int) $item->menu_order,
							'parent'      => (int) $item->menu_item_parent,
							'description' => $item->description,
						);
					},
					is_array( $items ) ? $items : array()
				),
			);
		},
		$menus
	);
}

function wpmcc_export_options() {
	$option_names = apply_filters(
		'wpmcc_backup_option_allowlist',
		array(
			'blogname',
			'blogdescription',
			'home',
			'siteurl',
			'permalink_structure',
			'show_on_front',
			'page_on_front',
			'page_for_posts',
			'timezone_string',
			'date_format',
			'time_format',
			'start_of_week',
			'rank_math_options_titles',
			'rank_math_options_sitemap',
			'wpseo_titles',
			'wpseo_social',
			'wpseo_taxonomy_meta',
			'seopress_titles_option_name',
			'seopress_xml_sitemap_option_name',
		)
	);

	$result = array();
	foreach ( $option_names as $name ) {
		$result[ $name ] = get_option( $name );
	}
	return $result;
}

function wpmcc_export_media_catalog() {
	$attachments = get_posts(
		array(
			'post_type'        => 'attachment',
			'post_status'      => 'inherit',
			'posts_per_page'   => -1,
			'orderby'          => 'ID',
			'order'            => 'ASC',
			'suppress_filters' => false,
		)
	);

	return array_map(
		function ( $attachment ) {
			return array(
				'id'          => $attachment->ID,
				'title'       => $attachment->post_title,
				'caption'     => $attachment->post_excerpt,
				'description' => $attachment->post_content,
				'alt_text'    => get_post_meta( $attachment->ID, '_wp_attachment_image_alt', true ),
				'mime_type'   => $attachment->post_mime_type,
				'url'         => wp_get_attachment_url( $attachment->ID ),
				'metadata'    => wp_get_attachment_metadata( $attachment->ID ),
				'parent'      => (int) $attachment->post_parent,
				'date'        => $attachment->post_date,
				'modified'    => $attachment->post_modified,
			);
		},
		$attachments
	);
}

function wpmcc_export_authors() {
	$users = get_users( array( 'fields' => 'all' ) );
	return array_map(
		function ( $user ) {
			return array(
				'id'           => $user->ID,
				'user_login'   => $user->user_login,
				'display_name' => $user->display_name,
				'roles'        => $user->roles,
			);
		},
		$users
	);
}

function wpmcc_backup_export( WP_REST_Request $request ) {
	if ( ! wpmcc_backup_exports_allowed() ) {
		return wpmcc_rest_error( 'backup_exports_disabled', 'Backup exports are disabled in companion permissions.', 403 );
	}

	$theme = wp_get_theme();

	return rest_ensure_response(
		array(
			'ok'                    => true,
			'source'                => 'wordpress-companion',
			'generated_at'          => gmdate( 'c' ),
			'version'               => WPMCC_VERSION,
			'site'                  => array(
				'name'        => get_bloginfo( 'name' ),
				'description' => get_bloginfo( 'description' ),
				'home_url'    => home_url( '/' ),
				'site_url'    => site_url( '/' ),
				'wp_version'  => get_bloginfo( 'version' ),
				'language'    => get_bloginfo( 'language' ),
				'timezone'    => wp_timezone_string(),
			),
			'theme'                 => array(
				'name'    => $theme->get( 'Name' ),
				'version' => $theme->get( 'Version' ),
				'slug'    => get_stylesheet(),
			),
			'active_plugins'        => get_option( 'active_plugins', array() ),
			'options'               => wpmcc_export_options(),
			'authors'               => wpmcc_export_authors(),
			'content'               => wpmcc_export_content(),
			'taxonomies'            => wpmcc_export_taxonomies(),
			'menus'                 => wpmcc_export_menus(),
			'media'                 => rest_sanitize_boolean( $request->get_param( 'include_media_catalog' ) ) ? wpmcc_export_media_catalog() : array(),
			'warnings'              => array( 'Media binaries, server files, and database secrets are not included in this JSON export.' ),
		)
	);
}

function wpmcc_install_package( WP_REST_Request $request ) {
	if ( ! wpmcc_package_installs_allowed() ) {
		return wpmcc_rest_error(
			'package_installs_disabled',
			'Package installs are disabled. Enable the local dashboard package-install permission for this site.',
			403
		);
	}

	$type     = $request->get_param( 'type' );
	$filename = sanitize_file_name( wp_basename( (string) $request->get_param( 'filename' ) ) );
	if ( '.zip' !== substr( strtolower( $filename ), -4 ) ) {
		return wpmcc_rest_error( 'invalid_package_type', 'Only .zip packages are supported.' );
	}

	$raw = base64_decode( (string) $request->get_param( 'file_base64' ), true );
	if ( false === $raw || '' === $raw ) {
		return wpmcc_rest_error( 'invalid_package_payload', 'file_base64 could not be decoded.' );
	}

	if ( strlen( $raw ) > 50 * MB_IN_BYTES ) {
		return wpmcc_rest_error( 'package_too_large', 'Package exceeds the 50 MB limit.', 413 );
	}

	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	require_once ABSPATH . 'wp-admin/includes/theme.php';

	$temp_file = wp_tempnam( $filename );
	if ( ! $temp_file ) {
		return wpmcc_rest_error( 'temp_file_failed', 'Could not create a temporary package file.', 500 );
	}

	if ( false === file_put_contents( $temp_file, $raw ) ) {
		@unlink( $temp_file );
		return wpmcc_rest_error( 'temp_file_write_failed', 'Could not write the temporary package file.', 500 );
	}

	WP_Filesystem();
	$skin = new Automatic_Upgrader_Skin();

	if ( 'plugin' === $type ) {
		$upgrader = new Plugin_Upgrader( $skin );
		$result   = $upgrader->install( $temp_file, array( 'overwrite_package' => true ) );
	} else {
		$upgrader = new Theme_Upgrader( $skin );
		$result   = $upgrader->install( $temp_file, array( 'overwrite_package' => true ) );
	}

	@unlink( $temp_file );

	if ( is_wp_error( $result ) ) {
		return $result;
	}

	if ( false === $result ) {
		return wpmcc_rest_error( 'package_install_failed', 'WordPress upgrader did not complete the install.', 500 );
	}

	return rest_ensure_response(
		array(
			'ok'      => true,
			'type'    => $type,
			'message' => ucfirst( $type ) . ' package installed. Activation is intentionally handled separately.',
		)
	);
}

add_action(
	'template_redirect',
	function () {
		$path = parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH );
		$path = '/' . ltrim( (string) $path, '/' );

		if ( '/llms.txt' === $path ) {
			$content = (string) get_option( WPMCC_OPTION_LLMS_TXT, '' );
		} elseif ( '/llms-full.txt' === $path ) {
			$content = (string) get_option( WPMCC_OPTION_LLMS_FULL_TXT, '' );
		} else {
			return;
		}

		if ( '' === trim( $content ) ) {
			status_header( 404 );
			header( 'Content-Type: text/plain; charset=utf-8' );
			echo 'Not configured.';
			exit;
		}

		status_header( 200 );
		header( 'Content-Type: text/plain; charset=utf-8' );
		header( 'Cache-Control: public, max-age=300' );
		echo $content;
		exit;
	}
);
